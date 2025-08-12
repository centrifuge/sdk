export type Maybe<T> = T | null
export type InputMaybe<T> = Maybe<T>
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] }
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> }
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> }
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never }
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never }
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string }
  String: { input: string; output: string }
  Boolean: { input: boolean; output: boolean }
  Int: { input: number; output: number }
  Float: { input: number; output: number }
  /** The `JSON` scalar type represents JSON values as specified by [ECMA-404](http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf). */
  JSON: { input: any; output: any }
  BigInt: { input: any; output: any }
}

export type PageInfo = {
  __typename?: 'PageInfo'
  hasNextPage: Scalars['Boolean']['output']
  hasPreviousPage: Scalars['Boolean']['output']
  startCursor?: Maybe<Scalars['String']['output']>
  endCursor?: Maybe<Scalars['String']['output']>
}

export type Meta = {
  __typename?: 'Meta'
  status?: Maybe<Scalars['JSON']['output']>
}

export type Query = {
  __typename?: 'Query'
  blockchain?: Maybe<Blockchain>
  blockchains: BlockchainPage
  deployment?: Maybe<Deployment>
  deployments: DeploymentPage
  pool?: Maybe<Pool>
  pools: PoolPage
  token?: Maybe<Token>
  tokens: TokenPage
  vault?: Maybe<Vault>
  vaults: VaultPage
  investorTransaction?: Maybe<InvestorTransaction>
  investorTransactions: InvestorTransactionPage
  outstandingInvest?: Maybe<OutstandingInvest>
  outstandingInvests: OutstandingInvestPage
  outstandingRedeem?: Maybe<OutstandingRedeem>
  outstandingRedeems: OutstandingRedeemPage
  investOrder?: Maybe<InvestOrder>
  investOrders: InvestOrderPage
  redeemOrder?: Maybe<RedeemOrder>
  redeemOrders: RedeemOrderPage
  epochOutstandingInvest?: Maybe<EpochOutstandingInvest>
  epochOutstandingInvests: EpochOutstandingInvestPage
  epochOutstandingRedeem?: Maybe<EpochOutstandingRedeem>
  epochOutstandingRedeems: EpochOutstandingRedeemPage
  epochInvestOrder?: Maybe<EpochInvestOrder>
  epochInvestOrders: EpochInvestOrderPage
  epochRedeemOrder?: Maybe<EpochRedeemOrder>
  epochRedeemOrders: EpochRedeemOrderPage
  assetRegistration?: Maybe<AssetRegistration>
  assetRegistrations: AssetRegistrationPage
  asset?: Maybe<Asset>
  assets: AssetPage
  tokenInstance?: Maybe<TokenInstance>
  tokenInstances: TokenInstancePage
  holding?: Maybe<Holding>
  holdings: HoldingPage
  holdingAccount?: Maybe<HoldingAccount>
  holdingAccounts: HoldingAccountPage
  escrow?: Maybe<Escrow>
  escrows: EscrowPage
  holdingEscrow?: Maybe<HoldingEscrow>
  holdingEscrows: HoldingEscrowPage
  poolManager?: Maybe<PoolManager>
  poolManagers: PoolManagerPage
  offrampRelayer?: Maybe<OfframpRelayer>
  offrampRelayers: OfframpRelayerPage
  onRampAsset?: Maybe<OnRampAsset>
  onRampAssets: OnRampAssetPage
  offRampAddress?: Maybe<OffRampAddress>
  offRampAddresss: OffRampAddressPage
  policy?: Maybe<Policy>
  policys: PolicyPage
  crosschainPayload?: Maybe<CrosschainPayload>
  crosschainPayloads: CrosschainPayloadPage
  crosschainMessage?: Maybe<CrosschainMessage>
  crosschainMessages: CrosschainMessagePage
  poolSnapshot?: Maybe<PoolSnapshot>
  poolSnapshots: PoolSnapshotPage
  tokenSnapshot?: Maybe<TokenSnapshot>
  tokenSnapshots: TokenSnapshotPage
  tokenInstanceSnapshot?: Maybe<TokenInstanceSnapshot>
  tokenInstanceSnapshots: TokenInstanceSnapshotPage
  holdingSnapshot?: Maybe<HoldingSnapshot>
  holdingSnapshots: HoldingSnapshotPage
  _meta?: Maybe<Meta>
}

export type QueryBlockchainArgs = {
  id: Scalars['String']['input']
}

export type QueryBlockchainsArgs = {
  where?: InputMaybe<BlockchainFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryDeploymentArgs = {
  chainId: Scalars['String']['input']
}

export type QueryDeploymentsArgs = {
  where?: InputMaybe<DeploymentFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryPoolArgs = {
  id: Scalars['BigInt']['input']
}

export type QueryPoolsArgs = {
  where?: InputMaybe<PoolFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryTokenArgs = {
  id: Scalars['String']['input']
}

export type QueryTokensArgs = {
  where?: InputMaybe<TokenFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryVaultArgs = {
  id: Scalars['String']['input']
  centrifugeId: Scalars['String']['input']
}

export type QueryVaultsArgs = {
  where?: InputMaybe<VaultFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryInvestorTransactionArgs = {
  poolId: Scalars['BigInt']['input']
  tokenId: Scalars['String']['input']
  account: Scalars['String']['input']
  type: Scalars['String']['input']
  txHash: Scalars['String']['input']
}

export type QueryInvestorTransactionsArgs = {
  where?: InputMaybe<InvestorTransactionFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryOutstandingInvestArgs = {
  tokenId: Scalars['String']['input']
  assetId: Scalars['BigInt']['input']
  account: Scalars['String']['input']
}

export type QueryOutstandingInvestsArgs = {
  where?: InputMaybe<OutstandingInvestFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryOutstandingRedeemArgs = {
  tokenId: Scalars['String']['input']
  assetId: Scalars['BigInt']['input']
  account: Scalars['String']['input']
}

export type QueryOutstandingRedeemsArgs = {
  where?: InputMaybe<OutstandingRedeemFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryInvestOrderArgs = {
  tokenId: Scalars['String']['input']
  assetId: Scalars['BigInt']['input']
  account: Scalars['String']['input']
  index: Scalars['Float']['input']
}

export type QueryInvestOrdersArgs = {
  where?: InputMaybe<InvestOrderFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryRedeemOrderArgs = {
  tokenId: Scalars['String']['input']
  assetId: Scalars['BigInt']['input']
  account: Scalars['String']['input']
  index: Scalars['Float']['input']
}

export type QueryRedeemOrdersArgs = {
  where?: InputMaybe<RedeemOrderFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryEpochOutstandingInvestArgs = {
  tokenId: Scalars['String']['input']
  assetId: Scalars['BigInt']['input']
}

export type QueryEpochOutstandingInvestsArgs = {
  where?: InputMaybe<EpochOutstandingInvestFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryEpochOutstandingRedeemArgs = {
  tokenId: Scalars['String']['input']
  assetId: Scalars['BigInt']['input']
}

export type QueryEpochOutstandingRedeemsArgs = {
  where?: InputMaybe<EpochOutstandingRedeemFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryEpochInvestOrderArgs = {
  tokenId: Scalars['String']['input']
  assetId: Scalars['BigInt']['input']
  index: Scalars['Float']['input']
}

export type QueryEpochInvestOrdersArgs = {
  where?: InputMaybe<EpochInvestOrderFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryEpochRedeemOrderArgs = {
  tokenId: Scalars['String']['input']
  assetId: Scalars['BigInt']['input']
  index: Scalars['Float']['input']
}

export type QueryEpochRedeemOrdersArgs = {
  where?: InputMaybe<EpochRedeemOrderFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryAssetRegistrationArgs = {
  assetId: Scalars['BigInt']['input']
  centrifugeId: Scalars['String']['input']
}

export type QueryAssetRegistrationsArgs = {
  where?: InputMaybe<AssetRegistrationFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryAssetArgs = {
  id: Scalars['BigInt']['input']
}

export type QueryAssetsArgs = {
  where?: InputMaybe<AssetFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryTokenInstanceArgs = {
  centrifugeId: Scalars['String']['input']
  tokenId: Scalars['String']['input']
}

export type QueryTokenInstancesArgs = {
  where?: InputMaybe<TokenInstanceFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryHoldingArgs = {
  tokenId: Scalars['String']['input']
  assetId: Scalars['BigInt']['input']
}

export type QueryHoldingsArgs = {
  where?: InputMaybe<HoldingFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryHoldingAccountArgs = {
  id: Scalars['String']['input']
}

export type QueryHoldingAccountsArgs = {
  where?: InputMaybe<HoldingAccountFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryEscrowArgs = {
  address: Scalars['String']['input']
  centrifugeId: Scalars['String']['input']
}

export type QueryEscrowsArgs = {
  where?: InputMaybe<EscrowFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryHoldingEscrowArgs = {
  tokenId: Scalars['String']['input']
  assetId: Scalars['BigInt']['input']
}

export type QueryHoldingEscrowsArgs = {
  where?: InputMaybe<HoldingEscrowFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryPoolManagerArgs = {
  address: Scalars['String']['input']
  centrifugeId: Scalars['String']['input']
  poolId: Scalars['BigInt']['input']
}

export type QueryPoolManagersArgs = {
  where?: InputMaybe<PoolManagerFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryOfframpRelayerArgs = {
  address: Scalars['String']['input']
}

export type QueryOfframpRelayersArgs = {
  where?: InputMaybe<OfframpRelayerFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryOnRampAssetArgs = {
  tokenId: Scalars['String']['input']
  assetAddress: Scalars['String']['input']
}

export type QueryOnRampAssetsArgs = {
  where?: InputMaybe<OnRampAssetFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryOffRampAddressArgs = {
  tokenId: Scalars['String']['input']
  assetAddress: Scalars['String']['input']
  receiverAddress: Scalars['String']['input']
}

export type QueryOffRampAddresssArgs = {
  where?: InputMaybe<OffRampAddressFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryPolicyArgs = {
  poolId: Scalars['BigInt']['input']
  centrifugeId: Scalars['String']['input']
}

export type QueryPolicysArgs = {
  where?: InputMaybe<PolicyFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryCrosschainPayloadArgs = {
  id: Scalars['String']['input']
  fromCentrifugeId: Scalars['String']['input']
  toCentrifugeId: Scalars['String']['input']
}

export type QueryCrosschainPayloadsArgs = {
  where?: InputMaybe<CrosschainPayloadFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryCrosschainMessageArgs = {
  id: Scalars['String']['input']
  index: Scalars['Float']['input']
}

export type QueryCrosschainMessagesArgs = {
  where?: InputMaybe<CrosschainMessageFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryPoolSnapshotArgs = {
  id: Scalars['BigInt']['input']
  blockNumber: Scalars['Float']['input']
  trigger: Scalars['String']['input']
}

export type QueryPoolSnapshotsArgs = {
  where?: InputMaybe<PoolSnapshotFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryTokenSnapshotArgs = {
  id: Scalars['String']['input']
  blockNumber: Scalars['Float']['input']
  trigger: Scalars['String']['input']
}

export type QueryTokenSnapshotsArgs = {
  where?: InputMaybe<TokenSnapshotFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryTokenInstanceSnapshotArgs = {
  tokenId: Scalars['String']['input']
  blockNumber: Scalars['Float']['input']
  trigger: Scalars['String']['input']
}

export type QueryTokenInstanceSnapshotsArgs = {
  where?: InputMaybe<TokenInstanceSnapshotFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type QueryHoldingSnapshotArgs = {
  tokenId: Scalars['String']['input']
  assetId: Scalars['BigInt']['input']
  blockNumber: Scalars['Float']['input']
  trigger: Scalars['String']['input']
}

export type QueryHoldingSnapshotsArgs = {
  where?: InputMaybe<HoldingSnapshotFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type Blockchain = {
  __typename?: 'Blockchain'
  id: Scalars['String']['output']
  centrifugeId: Scalars['String']['output']
  network: Scalars['String']['output']
  lastPeriodStart?: Maybe<Scalars['String']['output']>
  pools?: Maybe<PoolPage>
  tokens?: Maybe<TokenPage>
  tokenInstances?: Maybe<TokenInstancePage>
  vaults?: Maybe<VaultPage>
  assets?: Maybe<AssetPage>
  assetRegistrations?: Maybe<AssetRegistrationPage>
  investorTransactions?: Maybe<InvestorTransactionPage>
  holdings?: Maybe<HoldingPage>
  holdingEscrows?: Maybe<HoldingEscrowPage>
  escrows?: Maybe<EscrowPage>
}

export type BlockchainPoolsArgs = {
  where?: InputMaybe<PoolFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type BlockchainTokensArgs = {
  where?: InputMaybe<TokenFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type BlockchainTokenInstancesArgs = {
  where?: InputMaybe<TokenInstanceFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type BlockchainVaultsArgs = {
  where?: InputMaybe<VaultFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type BlockchainAssetsArgs = {
  where?: InputMaybe<AssetFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type BlockchainAssetRegistrationsArgs = {
  where?: InputMaybe<AssetRegistrationFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type BlockchainInvestorTransactionsArgs = {
  where?: InputMaybe<InvestorTransactionFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type BlockchainHoldingsArgs = {
  where?: InputMaybe<HoldingFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type BlockchainHoldingEscrowsArgs = {
  where?: InputMaybe<HoldingEscrowFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type BlockchainEscrowsArgs = {
  where?: InputMaybe<EscrowFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type PoolPage = {
  __typename?: 'PoolPage'
  items: Array<Pool>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type Pool = {
  __typename?: 'Pool'
  id: Scalars['BigInt']['output']
  centrifugeId: Scalars['String']['output']
  isActive: Scalars['Boolean']['output']
  createdAtBlock?: Maybe<Scalars['Int']['output']>
  createdAt?: Maybe<Scalars['String']['output']>
  currency?: Maybe<Scalars['BigInt']['output']>
  metadata?: Maybe<Scalars['String']['output']>
  name?: Maybe<Scalars['String']['output']>
  blockchain?: Maybe<Blockchain>
  tokens?: Maybe<TokenPage>
  snapshots?: Maybe<PoolSnapshotPage>
  managers?: Maybe<PoolManagerPage>
  policies?: Maybe<PolicyPage>
}

export type PoolTokensArgs = {
  where?: InputMaybe<TokenFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type PoolSnapshotsArgs = {
  where?: InputMaybe<PoolSnapshotFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type PoolManagersArgs = {
  where?: InputMaybe<PoolManagerFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type PoolPoliciesArgs = {
  where?: InputMaybe<PolicyFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type TokenPage = {
  __typename?: 'TokenPage'
  items: Array<Token>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type Token = {
  __typename?: 'Token'
  id: Scalars['String']['output']
  index?: Maybe<Scalars['Int']['output']>
  isActive: Scalars['Boolean']['output']
  centrifugeId?: Maybe<Scalars['String']['output']>
  poolId: Scalars['BigInt']['output']
  name?: Maybe<Scalars['String']['output']>
  symbol?: Maybe<Scalars['String']['output']>
  salt?: Maybe<Scalars['String']['output']>
  totalIssuance?: Maybe<Scalars['BigInt']['output']>
  tokenPrice?: Maybe<Scalars['BigInt']['output']>
  blockchain?: Maybe<Blockchain>
  pool?: Maybe<Pool>
  vaults?: Maybe<VaultPage>
  tokenInstances?: Maybe<TokenInstancePage>
  investorTransactions?: Maybe<InvestorTransactionPage>
  OutstandingInvests?: Maybe<OutstandingInvestPage>
  onRampAssets?: Maybe<OnRampAssetPage>
  offRampAddresses?: Maybe<OffRampAddressPage>
}

export type TokenVaultsArgs = {
  where?: InputMaybe<VaultFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type TokenTokenInstancesArgs = {
  where?: InputMaybe<TokenInstanceFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type TokenInvestorTransactionsArgs = {
  where?: InputMaybe<InvestorTransactionFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type TokenOutstandingInvestsArgs = {
  where?: InputMaybe<OutstandingInvestFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type TokenOnRampAssetsArgs = {
  where?: InputMaybe<OnRampAssetFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type TokenOffRampAddressesArgs = {
  where?: InputMaybe<OffRampAddressFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type VaultPage = {
  __typename?: 'VaultPage'
  items: Array<Vault>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type Vault = {
  __typename?: 'Vault'
  id: Scalars['String']['output']
  centrifugeId: Scalars['String']['output']
  isActive: Scalars['Boolean']['output']
  kind?: Maybe<VaultKind>
  status?: Maybe<VaultStatus>
  poolId: Scalars['BigInt']['output']
  tokenId: Scalars['String']['output']
  assetAddress: Scalars['String']['output']
  factory: Scalars['String']['output']
  manager?: Maybe<Scalars['String']['output']>
  blockchain?: Maybe<Blockchain>
  token?: Maybe<Token>
  asset?: Maybe<Asset>
  tokenInstance?: Maybe<TokenInstance>
}

export enum VaultKind {
  Async = 'Async',
  Sync = 'Sync',
  SyncDepositAsyncRedeem = 'SyncDepositAsyncRedeem',
}

export enum VaultStatus {
  LinkInProgress = 'LinkInProgress',
  UnlinkInProgress = 'UnlinkInProgress',
  Linked = 'Linked',
  Unlinked = 'Unlinked',
}

export type Asset = {
  __typename?: 'Asset'
  id: Scalars['BigInt']['output']
  centrifugeId: Scalars['String']['output']
  address: Scalars['String']['output']
  assetTokenId?: Maybe<Scalars['BigInt']['output']>
  decimals?: Maybe<Scalars['Int']['output']>
  name?: Maybe<Scalars['String']['output']>
  symbol?: Maybe<Scalars['String']['output']>
  blockchain?: Maybe<Blockchain>
  assetRegistrations?: Maybe<AssetRegistrationPage>
}

export type AssetAssetRegistrationsArgs = {
  where?: InputMaybe<AssetRegistrationFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type AssetRegistrationPage = {
  __typename?: 'AssetRegistrationPage'
  items: Array<AssetRegistration>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type AssetRegistration = {
  __typename?: 'AssetRegistration'
  assetId: Scalars['BigInt']['output']
  centrifugeId: Scalars['String']['output']
  assetCentrifugeId?: Maybe<Scalars['String']['output']>
  status?: Maybe<AssetRegistrationStatus>
  decimals?: Maybe<Scalars['Int']['output']>
  name?: Maybe<Scalars['String']['output']>
  symbol?: Maybe<Scalars['String']['output']>
  createdAt?: Maybe<Scalars['String']['output']>
  createdAtBlock?: Maybe<Scalars['Int']['output']>
  blockchain?: Maybe<Blockchain>
  asset?: Maybe<Asset>
}

export enum AssetRegistrationStatus {
  InProgress = 'IN_PROGRESS',
  Registered = 'REGISTERED',
}

export type AssetRegistrationFilter = {
  AND?: InputMaybe<Array<InputMaybe<AssetRegistrationFilter>>>
  OR?: InputMaybe<Array<InputMaybe<AssetRegistrationFilter>>>
  assetId?: InputMaybe<Scalars['BigInt']['input']>
  assetId_not?: InputMaybe<Scalars['BigInt']['input']>
  assetId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lte?: InputMaybe<Scalars['BigInt']['input']>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetCentrifugeId?: InputMaybe<Scalars['String']['input']>
  assetCentrifugeId_not?: InputMaybe<Scalars['String']['input']>
  assetCentrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  assetCentrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  assetCentrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  assetCentrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  assetCentrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  assetCentrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  assetCentrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  assetCentrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  status?: InputMaybe<AssetRegistrationStatus>
  status_not?: InputMaybe<AssetRegistrationStatus>
  status_in?: InputMaybe<Array<InputMaybe<AssetRegistrationStatus>>>
  status_not_in?: InputMaybe<Array<InputMaybe<AssetRegistrationStatus>>>
  decimals?: InputMaybe<Scalars['Int']['input']>
  decimals_not?: InputMaybe<Scalars['Int']['input']>
  decimals_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  decimals_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  decimals_gt?: InputMaybe<Scalars['Int']['input']>
  decimals_lt?: InputMaybe<Scalars['Int']['input']>
  decimals_gte?: InputMaybe<Scalars['Int']['input']>
  decimals_lte?: InputMaybe<Scalars['Int']['input']>
  name?: InputMaybe<Scalars['String']['input']>
  name_not?: InputMaybe<Scalars['String']['input']>
  name_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  name_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  name_contains?: InputMaybe<Scalars['String']['input']>
  name_not_contains?: InputMaybe<Scalars['String']['input']>
  name_starts_with?: InputMaybe<Scalars['String']['input']>
  name_ends_with?: InputMaybe<Scalars['String']['input']>
  name_not_starts_with?: InputMaybe<Scalars['String']['input']>
  name_not_ends_with?: InputMaybe<Scalars['String']['input']>
  symbol?: InputMaybe<Scalars['String']['input']>
  symbol_not?: InputMaybe<Scalars['String']['input']>
  symbol_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  symbol_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  symbol_contains?: InputMaybe<Scalars['String']['input']>
  symbol_not_contains?: InputMaybe<Scalars['String']['input']>
  symbol_starts_with?: InputMaybe<Scalars['String']['input']>
  symbol_ends_with?: InputMaybe<Scalars['String']['input']>
  symbol_not_starts_with?: InputMaybe<Scalars['String']['input']>
  symbol_not_ends_with?: InputMaybe<Scalars['String']['input']>
  createdAt?: InputMaybe<Scalars['String']['input']>
  createdAt_not?: InputMaybe<Scalars['String']['input']>
  createdAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  createdAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  createdAt_contains?: InputMaybe<Scalars['String']['input']>
  createdAt_not_contains?: InputMaybe<Scalars['String']['input']>
  createdAt_starts_with?: InputMaybe<Scalars['String']['input']>
  createdAt_ends_with?: InputMaybe<Scalars['String']['input']>
  createdAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  createdAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  createdAtBlock?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  createdAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  createdAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
}

export type TokenInstance = {
  __typename?: 'TokenInstance'
  centrifugeId: Scalars['String']['output']
  tokenId: Scalars['String']['output']
  isActive: Scalars['Boolean']['output']
  address: Scalars['String']['output']
  tokenPrice?: Maybe<Scalars['BigInt']['output']>
  computedAt?: Maybe<Scalars['String']['output']>
  totalIssuance?: Maybe<Scalars['BigInt']['output']>
  blockchain?: Maybe<Blockchain>
  token?: Maybe<Token>
  vaults?: Maybe<VaultPage>
}

export type TokenInstanceVaultsArgs = {
  where?: InputMaybe<VaultFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type VaultFilter = {
  AND?: InputMaybe<Array<InputMaybe<VaultFilter>>>
  OR?: InputMaybe<Array<InputMaybe<VaultFilter>>>
  id?: InputMaybe<Scalars['String']['input']>
  id_not?: InputMaybe<Scalars['String']['input']>
  id_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  id_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  id_contains?: InputMaybe<Scalars['String']['input']>
  id_not_contains?: InputMaybe<Scalars['String']['input']>
  id_starts_with?: InputMaybe<Scalars['String']['input']>
  id_ends_with?: InputMaybe<Scalars['String']['input']>
  id_not_starts_with?: InputMaybe<Scalars['String']['input']>
  id_not_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  isActive?: InputMaybe<Scalars['Boolean']['input']>
  isActive_not?: InputMaybe<Scalars['Boolean']['input']>
  isActive_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  isActive_not_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  kind?: InputMaybe<VaultKind>
  kind_not?: InputMaybe<VaultKind>
  kind_in?: InputMaybe<Array<InputMaybe<VaultKind>>>
  kind_not_in?: InputMaybe<Array<InputMaybe<VaultKind>>>
  status?: InputMaybe<VaultStatus>
  status_not?: InputMaybe<VaultStatus>
  status_in?: InputMaybe<Array<InputMaybe<VaultStatus>>>
  status_not_in?: InputMaybe<Array<InputMaybe<VaultStatus>>>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetAddress?: InputMaybe<Scalars['String']['input']>
  assetAddress_not?: InputMaybe<Scalars['String']['input']>
  assetAddress_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  assetAddress_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  assetAddress_contains?: InputMaybe<Scalars['String']['input']>
  assetAddress_not_contains?: InputMaybe<Scalars['String']['input']>
  assetAddress_starts_with?: InputMaybe<Scalars['String']['input']>
  assetAddress_ends_with?: InputMaybe<Scalars['String']['input']>
  assetAddress_not_starts_with?: InputMaybe<Scalars['String']['input']>
  assetAddress_not_ends_with?: InputMaybe<Scalars['String']['input']>
  factory?: InputMaybe<Scalars['String']['input']>
  factory_not?: InputMaybe<Scalars['String']['input']>
  factory_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  factory_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  factory_contains?: InputMaybe<Scalars['String']['input']>
  factory_not_contains?: InputMaybe<Scalars['String']['input']>
  factory_starts_with?: InputMaybe<Scalars['String']['input']>
  factory_ends_with?: InputMaybe<Scalars['String']['input']>
  factory_not_starts_with?: InputMaybe<Scalars['String']['input']>
  factory_not_ends_with?: InputMaybe<Scalars['String']['input']>
  manager?: InputMaybe<Scalars['String']['input']>
  manager_not?: InputMaybe<Scalars['String']['input']>
  manager_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  manager_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  manager_contains?: InputMaybe<Scalars['String']['input']>
  manager_not_contains?: InputMaybe<Scalars['String']['input']>
  manager_starts_with?: InputMaybe<Scalars['String']['input']>
  manager_ends_with?: InputMaybe<Scalars['String']['input']>
  manager_not_starts_with?: InputMaybe<Scalars['String']['input']>
  manager_not_ends_with?: InputMaybe<Scalars['String']['input']>
}

export type TokenInstancePage = {
  __typename?: 'TokenInstancePage'
  items: Array<TokenInstance>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type TokenInstanceFilter = {
  AND?: InputMaybe<Array<InputMaybe<TokenInstanceFilter>>>
  OR?: InputMaybe<Array<InputMaybe<TokenInstanceFilter>>>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  isActive?: InputMaybe<Scalars['Boolean']['input']>
  isActive_not?: InputMaybe<Scalars['Boolean']['input']>
  isActive_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  isActive_not_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  address?: InputMaybe<Scalars['String']['input']>
  address_not?: InputMaybe<Scalars['String']['input']>
  address_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  address_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  address_contains?: InputMaybe<Scalars['String']['input']>
  address_not_contains?: InputMaybe<Scalars['String']['input']>
  address_starts_with?: InputMaybe<Scalars['String']['input']>
  address_ends_with?: InputMaybe<Scalars['String']['input']>
  address_not_starts_with?: InputMaybe<Scalars['String']['input']>
  address_not_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenPrice?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_not?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  tokenPrice_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  tokenPrice_gt?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_lt?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_gte?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_lte?: InputMaybe<Scalars['BigInt']['input']>
  computedAt?: InputMaybe<Scalars['String']['input']>
  computedAt_not?: InputMaybe<Scalars['String']['input']>
  computedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  computedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  computedAt_contains?: InputMaybe<Scalars['String']['input']>
  computedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  computedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  computedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  computedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  computedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  totalIssuance?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_not?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  totalIssuance_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  totalIssuance_gt?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_lt?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_gte?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_lte?: InputMaybe<Scalars['BigInt']['input']>
}

export type InvestorTransactionPage = {
  __typename?: 'InvestorTransactionPage'
  items: Array<InvestorTransaction>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type InvestorTransaction = {
  __typename?: 'InvestorTransaction'
  txHash: Scalars['String']['output']
  centrifugeId: Scalars['String']['output']
  poolId: Scalars['BigInt']['output']
  tokenId: Scalars['String']['output']
  type: InvestorTransactionType
  account: Scalars['String']['output']
  createdAt: Scalars['String']['output']
  createdAtBlock: Scalars['Int']['output']
  epochIndex?: Maybe<Scalars['Int']['output']>
  tokenAmount?: Maybe<Scalars['BigInt']['output']>
  currencyAmount?: Maybe<Scalars['BigInt']['output']>
  tokenPrice?: Maybe<Scalars['BigInt']['output']>
  transactionFee?: Maybe<Scalars['BigInt']['output']>
  blockchain?: Maybe<Blockchain>
  pool?: Maybe<Pool>
  token?: Maybe<Token>
}

export enum InvestorTransactionType {
  DepositRequestUpdated = 'DEPOSIT_REQUEST_UPDATED',
  RedeemRequestUpdated = 'REDEEM_REQUEST_UPDATED',
  DepositRequestCancelled = 'DEPOSIT_REQUEST_CANCELLED',
  RedeemRequestCancelled = 'REDEEM_REQUEST_CANCELLED',
  DepositRequestExecuted = 'DEPOSIT_REQUEST_EXECUTED',
  RedeemRequestExecuted = 'REDEEM_REQUEST_EXECUTED',
  DepositClaimable = 'DEPOSIT_CLAIMABLE',
  RedeemClaimable = 'REDEEM_CLAIMABLE',
  DepositClaimed = 'DEPOSIT_CLAIMED',
  RedeemClaimed = 'REDEEM_CLAIMED',
  SyncDeposit = 'SYNC_DEPOSIT',
  SyncRedeem = 'SYNC_REDEEM',
}

export type InvestorTransactionFilter = {
  AND?: InputMaybe<Array<InputMaybe<InvestorTransactionFilter>>>
  OR?: InputMaybe<Array<InputMaybe<InvestorTransactionFilter>>>
  txHash?: InputMaybe<Scalars['String']['input']>
  txHash_not?: InputMaybe<Scalars['String']['input']>
  txHash_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  txHash_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  txHash_contains?: InputMaybe<Scalars['String']['input']>
  txHash_not_contains?: InputMaybe<Scalars['String']['input']>
  txHash_starts_with?: InputMaybe<Scalars['String']['input']>
  txHash_ends_with?: InputMaybe<Scalars['String']['input']>
  txHash_not_starts_with?: InputMaybe<Scalars['String']['input']>
  txHash_not_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  type?: InputMaybe<InvestorTransactionType>
  type_not?: InputMaybe<InvestorTransactionType>
  type_in?: InputMaybe<Array<InputMaybe<InvestorTransactionType>>>
  type_not_in?: InputMaybe<Array<InputMaybe<InvestorTransactionType>>>
  account?: InputMaybe<Scalars['String']['input']>
  account_not?: InputMaybe<Scalars['String']['input']>
  account_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  account_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  account_contains?: InputMaybe<Scalars['String']['input']>
  account_not_contains?: InputMaybe<Scalars['String']['input']>
  account_starts_with?: InputMaybe<Scalars['String']['input']>
  account_ends_with?: InputMaybe<Scalars['String']['input']>
  account_not_starts_with?: InputMaybe<Scalars['String']['input']>
  account_not_ends_with?: InputMaybe<Scalars['String']['input']>
  createdAt?: InputMaybe<Scalars['String']['input']>
  createdAt_not?: InputMaybe<Scalars['String']['input']>
  createdAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  createdAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  createdAt_contains?: InputMaybe<Scalars['String']['input']>
  createdAt_not_contains?: InputMaybe<Scalars['String']['input']>
  createdAt_starts_with?: InputMaybe<Scalars['String']['input']>
  createdAt_ends_with?: InputMaybe<Scalars['String']['input']>
  createdAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  createdAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  createdAtBlock?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  createdAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  createdAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
  epochIndex?: InputMaybe<Scalars['Int']['input']>
  epochIndex_not?: InputMaybe<Scalars['Int']['input']>
  epochIndex_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  epochIndex_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  epochIndex_gt?: InputMaybe<Scalars['Int']['input']>
  epochIndex_lt?: InputMaybe<Scalars['Int']['input']>
  epochIndex_gte?: InputMaybe<Scalars['Int']['input']>
  epochIndex_lte?: InputMaybe<Scalars['Int']['input']>
  tokenAmount?: InputMaybe<Scalars['BigInt']['input']>
  tokenAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  tokenAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  tokenAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  tokenAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  tokenAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  tokenAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  tokenAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  currencyAmount?: InputMaybe<Scalars['BigInt']['input']>
  currencyAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  currencyAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  currencyAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  currencyAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  currencyAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  currencyAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  currencyAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_not?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  tokenPrice_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  tokenPrice_gt?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_lt?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_gte?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_lte?: InputMaybe<Scalars['BigInt']['input']>
  transactionFee?: InputMaybe<Scalars['BigInt']['input']>
  transactionFee_not?: InputMaybe<Scalars['BigInt']['input']>
  transactionFee_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  transactionFee_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  transactionFee_gt?: InputMaybe<Scalars['BigInt']['input']>
  transactionFee_lt?: InputMaybe<Scalars['BigInt']['input']>
  transactionFee_gte?: InputMaybe<Scalars['BigInt']['input']>
  transactionFee_lte?: InputMaybe<Scalars['BigInt']['input']>
}

export type OutstandingInvestPage = {
  __typename?: 'OutstandingInvestPage'
  items: Array<OutstandingInvest>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type OutstandingInvest = {
  __typename?: 'OutstandingInvest'
  poolId: Scalars['BigInt']['output']
  tokenId: Scalars['String']['output']
  assetId: Scalars['BigInt']['output']
  account: Scalars['String']['output']
  pendingAmount?: Maybe<Scalars['BigInt']['output']>
  queuedAmount?: Maybe<Scalars['BigInt']['output']>
  depositAmount?: Maybe<Scalars['BigInt']['output']>
  approvedAmount?: Maybe<Scalars['BigInt']['output']>
  approvedAt?: Maybe<Scalars['String']['output']>
  approvedAtBlock?: Maybe<Scalars['Int']['output']>
  updatedAt?: Maybe<Scalars['String']['output']>
  updatedAtBlock?: Maybe<Scalars['Int']['output']>
  token?: Maybe<Token>
}

export type OutstandingInvestFilter = {
  AND?: InputMaybe<Array<InputMaybe<OutstandingInvestFilter>>>
  OR?: InputMaybe<Array<InputMaybe<OutstandingInvestFilter>>>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetId?: InputMaybe<Scalars['BigInt']['input']>
  assetId_not?: InputMaybe<Scalars['BigInt']['input']>
  assetId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lte?: InputMaybe<Scalars['BigInt']['input']>
  account?: InputMaybe<Scalars['String']['input']>
  account_not?: InputMaybe<Scalars['String']['input']>
  account_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  account_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  account_contains?: InputMaybe<Scalars['String']['input']>
  account_not_contains?: InputMaybe<Scalars['String']['input']>
  account_starts_with?: InputMaybe<Scalars['String']['input']>
  account_ends_with?: InputMaybe<Scalars['String']['input']>
  account_not_starts_with?: InputMaybe<Scalars['String']['input']>
  account_not_ends_with?: InputMaybe<Scalars['String']['input']>
  pendingAmount?: InputMaybe<Scalars['BigInt']['input']>
  pendingAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  pendingAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  pendingAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  pendingAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  pendingAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  pendingAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  pendingAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  queuedAmount?: InputMaybe<Scalars['BigInt']['input']>
  queuedAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  queuedAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  queuedAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  queuedAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  queuedAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  queuedAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  queuedAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  depositAmount?: InputMaybe<Scalars['BigInt']['input']>
  depositAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  depositAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  depositAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  depositAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  depositAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  depositAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  depositAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  approvedAmount?: InputMaybe<Scalars['BigInt']['input']>
  approvedAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  approvedAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  approvedAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  approvedAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  approvedAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  approvedAt?: InputMaybe<Scalars['String']['input']>
  approvedAt_not?: InputMaybe<Scalars['String']['input']>
  approvedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  approvedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  approvedAt_contains?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  approvedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  approvedAtBlock?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  approvedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  approvedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
  updatedAt?: InputMaybe<Scalars['String']['input']>
  updatedAt_not?: InputMaybe<Scalars['String']['input']>
  updatedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  updatedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  updatedAt_contains?: InputMaybe<Scalars['String']['input']>
  updatedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  updatedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  updatedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  updatedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  updatedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  updatedAtBlock?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  updatedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  updatedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
}

export type OnRampAssetPage = {
  __typename?: 'OnRampAssetPage'
  items: Array<OnRampAsset>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type OnRampAsset = {
  __typename?: 'OnRampAsset'
  poolId: Scalars['BigInt']['output']
  tokenId: Scalars['String']['output']
  centrifugeId: Scalars['String']['output']
  assetAddress: Scalars['String']['output']
  token?: Maybe<Token>
  asset?: Maybe<Asset>
}

export type OnRampAssetFilter = {
  AND?: InputMaybe<Array<InputMaybe<OnRampAssetFilter>>>
  OR?: InputMaybe<Array<InputMaybe<OnRampAssetFilter>>>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetAddress?: InputMaybe<Scalars['String']['input']>
  assetAddress_not?: InputMaybe<Scalars['String']['input']>
  assetAddress_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  assetAddress_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  assetAddress_contains?: InputMaybe<Scalars['String']['input']>
  assetAddress_not_contains?: InputMaybe<Scalars['String']['input']>
  assetAddress_starts_with?: InputMaybe<Scalars['String']['input']>
  assetAddress_ends_with?: InputMaybe<Scalars['String']['input']>
  assetAddress_not_starts_with?: InputMaybe<Scalars['String']['input']>
  assetAddress_not_ends_with?: InputMaybe<Scalars['String']['input']>
}

export type OffRampAddressPage = {
  __typename?: 'OffRampAddressPage'
  items: Array<OffRampAddress>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type OffRampAddress = {
  __typename?: 'OffRampAddress'
  poolId: Scalars['BigInt']['output']
  tokenId: Scalars['String']['output']
  centrifugeId: Scalars['String']['output']
  assetAddress: Scalars['String']['output']
  receiverAddress: Scalars['String']['output']
  token?: Maybe<Token>
  asset?: Maybe<Asset>
}

export type OffRampAddressFilter = {
  AND?: InputMaybe<Array<InputMaybe<OffRampAddressFilter>>>
  OR?: InputMaybe<Array<InputMaybe<OffRampAddressFilter>>>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetAddress?: InputMaybe<Scalars['String']['input']>
  assetAddress_not?: InputMaybe<Scalars['String']['input']>
  assetAddress_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  assetAddress_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  assetAddress_contains?: InputMaybe<Scalars['String']['input']>
  assetAddress_not_contains?: InputMaybe<Scalars['String']['input']>
  assetAddress_starts_with?: InputMaybe<Scalars['String']['input']>
  assetAddress_ends_with?: InputMaybe<Scalars['String']['input']>
  assetAddress_not_starts_with?: InputMaybe<Scalars['String']['input']>
  assetAddress_not_ends_with?: InputMaybe<Scalars['String']['input']>
  receiverAddress?: InputMaybe<Scalars['String']['input']>
  receiverAddress_not?: InputMaybe<Scalars['String']['input']>
  receiverAddress_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  receiverAddress_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  receiverAddress_contains?: InputMaybe<Scalars['String']['input']>
  receiverAddress_not_contains?: InputMaybe<Scalars['String']['input']>
  receiverAddress_starts_with?: InputMaybe<Scalars['String']['input']>
  receiverAddress_ends_with?: InputMaybe<Scalars['String']['input']>
  receiverAddress_not_starts_with?: InputMaybe<Scalars['String']['input']>
  receiverAddress_not_ends_with?: InputMaybe<Scalars['String']['input']>
}

export type TokenFilter = {
  AND?: InputMaybe<Array<InputMaybe<TokenFilter>>>
  OR?: InputMaybe<Array<InputMaybe<TokenFilter>>>
  id?: InputMaybe<Scalars['String']['input']>
  id_not?: InputMaybe<Scalars['String']['input']>
  id_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  id_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  id_contains?: InputMaybe<Scalars['String']['input']>
  id_not_contains?: InputMaybe<Scalars['String']['input']>
  id_starts_with?: InputMaybe<Scalars['String']['input']>
  id_ends_with?: InputMaybe<Scalars['String']['input']>
  id_not_starts_with?: InputMaybe<Scalars['String']['input']>
  id_not_ends_with?: InputMaybe<Scalars['String']['input']>
  index?: InputMaybe<Scalars['Int']['input']>
  index_not?: InputMaybe<Scalars['Int']['input']>
  index_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  index_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  index_gt?: InputMaybe<Scalars['Int']['input']>
  index_lt?: InputMaybe<Scalars['Int']['input']>
  index_gte?: InputMaybe<Scalars['Int']['input']>
  index_lte?: InputMaybe<Scalars['Int']['input']>
  isActive?: InputMaybe<Scalars['Boolean']['input']>
  isActive_not?: InputMaybe<Scalars['Boolean']['input']>
  isActive_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  isActive_not_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  name?: InputMaybe<Scalars['String']['input']>
  name_not?: InputMaybe<Scalars['String']['input']>
  name_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  name_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  name_contains?: InputMaybe<Scalars['String']['input']>
  name_not_contains?: InputMaybe<Scalars['String']['input']>
  name_starts_with?: InputMaybe<Scalars['String']['input']>
  name_ends_with?: InputMaybe<Scalars['String']['input']>
  name_not_starts_with?: InputMaybe<Scalars['String']['input']>
  name_not_ends_with?: InputMaybe<Scalars['String']['input']>
  symbol?: InputMaybe<Scalars['String']['input']>
  symbol_not?: InputMaybe<Scalars['String']['input']>
  symbol_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  symbol_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  symbol_contains?: InputMaybe<Scalars['String']['input']>
  symbol_not_contains?: InputMaybe<Scalars['String']['input']>
  symbol_starts_with?: InputMaybe<Scalars['String']['input']>
  symbol_ends_with?: InputMaybe<Scalars['String']['input']>
  symbol_not_starts_with?: InputMaybe<Scalars['String']['input']>
  symbol_not_ends_with?: InputMaybe<Scalars['String']['input']>
  salt?: InputMaybe<Scalars['String']['input']>
  salt_not?: InputMaybe<Scalars['String']['input']>
  salt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  salt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  salt_contains?: InputMaybe<Scalars['String']['input']>
  salt_not_contains?: InputMaybe<Scalars['String']['input']>
  salt_starts_with?: InputMaybe<Scalars['String']['input']>
  salt_ends_with?: InputMaybe<Scalars['String']['input']>
  salt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  salt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  totalIssuance?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_not?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  totalIssuance_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  totalIssuance_gt?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_lt?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_gte?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_not?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  tokenPrice_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  tokenPrice_gt?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_lt?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_gte?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_lte?: InputMaybe<Scalars['BigInt']['input']>
}

export type PoolSnapshotPage = {
  __typename?: 'PoolSnapshotPage'
  items: Array<PoolSnapshot>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type PoolSnapshot = {
  __typename?: 'PoolSnapshot'
  timestamp: Scalars['String']['output']
  blockNumber: Scalars['Int']['output']
  trigger: Scalars['String']['output']
  triggerTxHash?: Maybe<Scalars['String']['output']>
  triggerChainId: Scalars['String']['output']
  id: Scalars['BigInt']['output']
  currency?: Maybe<Scalars['BigInt']['output']>
  pool?: Maybe<Pool>
}

export type PoolSnapshotFilter = {
  AND?: InputMaybe<Array<InputMaybe<PoolSnapshotFilter>>>
  OR?: InputMaybe<Array<InputMaybe<PoolSnapshotFilter>>>
  timestamp?: InputMaybe<Scalars['String']['input']>
  timestamp_not?: InputMaybe<Scalars['String']['input']>
  timestamp_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  timestamp_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  timestamp_contains?: InputMaybe<Scalars['String']['input']>
  timestamp_not_contains?: InputMaybe<Scalars['String']['input']>
  timestamp_starts_with?: InputMaybe<Scalars['String']['input']>
  timestamp_ends_with?: InputMaybe<Scalars['String']['input']>
  timestamp_not_starts_with?: InputMaybe<Scalars['String']['input']>
  timestamp_not_ends_with?: InputMaybe<Scalars['String']['input']>
  blockNumber?: InputMaybe<Scalars['Int']['input']>
  blockNumber_not?: InputMaybe<Scalars['Int']['input']>
  blockNumber_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  blockNumber_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  blockNumber_gt?: InputMaybe<Scalars['Int']['input']>
  blockNumber_lt?: InputMaybe<Scalars['Int']['input']>
  blockNumber_gte?: InputMaybe<Scalars['Int']['input']>
  blockNumber_lte?: InputMaybe<Scalars['Int']['input']>
  trigger?: InputMaybe<Scalars['String']['input']>
  trigger_not?: InputMaybe<Scalars['String']['input']>
  trigger_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  trigger_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  trigger_contains?: InputMaybe<Scalars['String']['input']>
  trigger_not_contains?: InputMaybe<Scalars['String']['input']>
  trigger_starts_with?: InputMaybe<Scalars['String']['input']>
  trigger_ends_with?: InputMaybe<Scalars['String']['input']>
  trigger_not_starts_with?: InputMaybe<Scalars['String']['input']>
  trigger_not_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerTxHash_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerTxHash_contains?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not_contains?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not?: InputMaybe<Scalars['String']['input']>
  triggerChainId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerChainId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerChainId_contains?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not_contains?: InputMaybe<Scalars['String']['input']>
  triggerChainId_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  id?: InputMaybe<Scalars['BigInt']['input']>
  id_not?: InputMaybe<Scalars['BigInt']['input']>
  id_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  id_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  id_gt?: InputMaybe<Scalars['BigInt']['input']>
  id_lt?: InputMaybe<Scalars['BigInt']['input']>
  id_gte?: InputMaybe<Scalars['BigInt']['input']>
  id_lte?: InputMaybe<Scalars['BigInt']['input']>
  currency?: InputMaybe<Scalars['BigInt']['input']>
  currency_not?: InputMaybe<Scalars['BigInt']['input']>
  currency_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  currency_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  currency_gt?: InputMaybe<Scalars['BigInt']['input']>
  currency_lt?: InputMaybe<Scalars['BigInt']['input']>
  currency_gte?: InputMaybe<Scalars['BigInt']['input']>
  currency_lte?: InputMaybe<Scalars['BigInt']['input']>
}

export type PoolManagerPage = {
  __typename?: 'PoolManagerPage'
  items: Array<PoolManager>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type PoolManager = {
  __typename?: 'PoolManager'
  address: Scalars['String']['output']
  centrifugeId: Scalars['String']['output']
  poolId: Scalars['BigInt']['output']
  isHubManager: Scalars['Boolean']['output']
  isBalancesheetManager: Scalars['Boolean']['output']
  pool?: Maybe<Pool>
}

export type PoolManagerFilter = {
  AND?: InputMaybe<Array<InputMaybe<PoolManagerFilter>>>
  OR?: InputMaybe<Array<InputMaybe<PoolManagerFilter>>>
  address?: InputMaybe<Scalars['String']['input']>
  address_not?: InputMaybe<Scalars['String']['input']>
  address_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  address_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  address_contains?: InputMaybe<Scalars['String']['input']>
  address_not_contains?: InputMaybe<Scalars['String']['input']>
  address_starts_with?: InputMaybe<Scalars['String']['input']>
  address_ends_with?: InputMaybe<Scalars['String']['input']>
  address_not_starts_with?: InputMaybe<Scalars['String']['input']>
  address_not_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  isHubManager?: InputMaybe<Scalars['Boolean']['input']>
  isHubManager_not?: InputMaybe<Scalars['Boolean']['input']>
  isHubManager_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  isHubManager_not_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  isBalancesheetManager?: InputMaybe<Scalars['Boolean']['input']>
  isBalancesheetManager_not?: InputMaybe<Scalars['Boolean']['input']>
  isBalancesheetManager_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  isBalancesheetManager_not_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
}

export type PolicyPage = {
  __typename?: 'PolicyPage'
  items: Array<Policy>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type Policy = {
  __typename?: 'Policy'
  poolId: Scalars['BigInt']['output']
  centrifugeId: Scalars['String']['output']
  strategistAddress: Scalars['String']['output']
  root: Scalars['String']['output']
  pool?: Maybe<Pool>
}

export type PolicyFilter = {
  AND?: InputMaybe<Array<InputMaybe<PolicyFilter>>>
  OR?: InputMaybe<Array<InputMaybe<PolicyFilter>>>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  strategistAddress?: InputMaybe<Scalars['String']['input']>
  strategistAddress_not?: InputMaybe<Scalars['String']['input']>
  strategistAddress_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  strategistAddress_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  strategistAddress_contains?: InputMaybe<Scalars['String']['input']>
  strategistAddress_not_contains?: InputMaybe<Scalars['String']['input']>
  strategistAddress_starts_with?: InputMaybe<Scalars['String']['input']>
  strategistAddress_ends_with?: InputMaybe<Scalars['String']['input']>
  strategistAddress_not_starts_with?: InputMaybe<Scalars['String']['input']>
  strategistAddress_not_ends_with?: InputMaybe<Scalars['String']['input']>
  root?: InputMaybe<Scalars['String']['input']>
  root_not?: InputMaybe<Scalars['String']['input']>
  root_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  root_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  root_contains?: InputMaybe<Scalars['String']['input']>
  root_not_contains?: InputMaybe<Scalars['String']['input']>
  root_starts_with?: InputMaybe<Scalars['String']['input']>
  root_ends_with?: InputMaybe<Scalars['String']['input']>
  root_not_starts_with?: InputMaybe<Scalars['String']['input']>
  root_not_ends_with?: InputMaybe<Scalars['String']['input']>
}

export type PoolFilter = {
  AND?: InputMaybe<Array<InputMaybe<PoolFilter>>>
  OR?: InputMaybe<Array<InputMaybe<PoolFilter>>>
  id?: InputMaybe<Scalars['BigInt']['input']>
  id_not?: InputMaybe<Scalars['BigInt']['input']>
  id_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  id_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  id_gt?: InputMaybe<Scalars['BigInt']['input']>
  id_lt?: InputMaybe<Scalars['BigInt']['input']>
  id_gte?: InputMaybe<Scalars['BigInt']['input']>
  id_lte?: InputMaybe<Scalars['BigInt']['input']>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  isActive?: InputMaybe<Scalars['Boolean']['input']>
  isActive_not?: InputMaybe<Scalars['Boolean']['input']>
  isActive_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  isActive_not_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  createdAtBlock?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  createdAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  createdAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
  createdAt?: InputMaybe<Scalars['String']['input']>
  createdAt_not?: InputMaybe<Scalars['String']['input']>
  createdAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  createdAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  createdAt_contains?: InputMaybe<Scalars['String']['input']>
  createdAt_not_contains?: InputMaybe<Scalars['String']['input']>
  createdAt_starts_with?: InputMaybe<Scalars['String']['input']>
  createdAt_ends_with?: InputMaybe<Scalars['String']['input']>
  createdAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  createdAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  currency?: InputMaybe<Scalars['BigInt']['input']>
  currency_not?: InputMaybe<Scalars['BigInt']['input']>
  currency_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  currency_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  currency_gt?: InputMaybe<Scalars['BigInt']['input']>
  currency_lt?: InputMaybe<Scalars['BigInt']['input']>
  currency_gte?: InputMaybe<Scalars['BigInt']['input']>
  currency_lte?: InputMaybe<Scalars['BigInt']['input']>
  metadata?: InputMaybe<Scalars['String']['input']>
  metadata_not?: InputMaybe<Scalars['String']['input']>
  metadata_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  metadata_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  metadata_contains?: InputMaybe<Scalars['String']['input']>
  metadata_not_contains?: InputMaybe<Scalars['String']['input']>
  metadata_starts_with?: InputMaybe<Scalars['String']['input']>
  metadata_ends_with?: InputMaybe<Scalars['String']['input']>
  metadata_not_starts_with?: InputMaybe<Scalars['String']['input']>
  metadata_not_ends_with?: InputMaybe<Scalars['String']['input']>
  name?: InputMaybe<Scalars['String']['input']>
  name_not?: InputMaybe<Scalars['String']['input']>
  name_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  name_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  name_contains?: InputMaybe<Scalars['String']['input']>
  name_not_contains?: InputMaybe<Scalars['String']['input']>
  name_starts_with?: InputMaybe<Scalars['String']['input']>
  name_ends_with?: InputMaybe<Scalars['String']['input']>
  name_not_starts_with?: InputMaybe<Scalars['String']['input']>
  name_not_ends_with?: InputMaybe<Scalars['String']['input']>
}

export type AssetPage = {
  __typename?: 'AssetPage'
  items: Array<Asset>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type AssetFilter = {
  AND?: InputMaybe<Array<InputMaybe<AssetFilter>>>
  OR?: InputMaybe<Array<InputMaybe<AssetFilter>>>
  id?: InputMaybe<Scalars['BigInt']['input']>
  id_not?: InputMaybe<Scalars['BigInt']['input']>
  id_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  id_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  id_gt?: InputMaybe<Scalars['BigInt']['input']>
  id_lt?: InputMaybe<Scalars['BigInt']['input']>
  id_gte?: InputMaybe<Scalars['BigInt']['input']>
  id_lte?: InputMaybe<Scalars['BigInt']['input']>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  address?: InputMaybe<Scalars['String']['input']>
  address_not?: InputMaybe<Scalars['String']['input']>
  address_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  address_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  address_contains?: InputMaybe<Scalars['String']['input']>
  address_not_contains?: InputMaybe<Scalars['String']['input']>
  address_starts_with?: InputMaybe<Scalars['String']['input']>
  address_ends_with?: InputMaybe<Scalars['String']['input']>
  address_not_starts_with?: InputMaybe<Scalars['String']['input']>
  address_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetTokenId?: InputMaybe<Scalars['BigInt']['input']>
  assetTokenId_not?: InputMaybe<Scalars['BigInt']['input']>
  assetTokenId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetTokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetTokenId_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetTokenId_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetTokenId_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetTokenId_lte?: InputMaybe<Scalars['BigInt']['input']>
  decimals?: InputMaybe<Scalars['Int']['input']>
  decimals_not?: InputMaybe<Scalars['Int']['input']>
  decimals_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  decimals_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  decimals_gt?: InputMaybe<Scalars['Int']['input']>
  decimals_lt?: InputMaybe<Scalars['Int']['input']>
  decimals_gte?: InputMaybe<Scalars['Int']['input']>
  decimals_lte?: InputMaybe<Scalars['Int']['input']>
  name?: InputMaybe<Scalars['String']['input']>
  name_not?: InputMaybe<Scalars['String']['input']>
  name_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  name_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  name_contains?: InputMaybe<Scalars['String']['input']>
  name_not_contains?: InputMaybe<Scalars['String']['input']>
  name_starts_with?: InputMaybe<Scalars['String']['input']>
  name_ends_with?: InputMaybe<Scalars['String']['input']>
  name_not_starts_with?: InputMaybe<Scalars['String']['input']>
  name_not_ends_with?: InputMaybe<Scalars['String']['input']>
  symbol?: InputMaybe<Scalars['String']['input']>
  symbol_not?: InputMaybe<Scalars['String']['input']>
  symbol_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  symbol_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  symbol_contains?: InputMaybe<Scalars['String']['input']>
  symbol_not_contains?: InputMaybe<Scalars['String']['input']>
  symbol_starts_with?: InputMaybe<Scalars['String']['input']>
  symbol_ends_with?: InputMaybe<Scalars['String']['input']>
  symbol_not_starts_with?: InputMaybe<Scalars['String']['input']>
  symbol_not_ends_with?: InputMaybe<Scalars['String']['input']>
}

export type HoldingPage = {
  __typename?: 'HoldingPage'
  items: Array<Holding>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type Holding = {
  __typename?: 'Holding'
  centrifugeId: Scalars['String']['output']
  poolId: Scalars['BigInt']['output']
  tokenId: Scalars['String']['output']
  isInitialized: Scalars['Boolean']['output']
  isLiability?: Maybe<Scalars['Boolean']['output']>
  valuation?: Maybe<Scalars['String']['output']>
  assetId: Scalars['BigInt']['output']
  assetQuantity: Scalars['BigInt']['output']
  totalValue: Scalars['BigInt']['output']
  updatedAt?: Maybe<Scalars['String']['output']>
  updatedAtBlock?: Maybe<Scalars['Int']['output']>
  blockchain?: Maybe<Blockchain>
  token?: Maybe<Token>
  holdingEscrow?: Maybe<HoldingEscrow>
}

export type HoldingEscrow = {
  __typename?: 'HoldingEscrow'
  centrifugeId: Scalars['String']['output']
  poolId: Scalars['BigInt']['output']
  tokenId: Scalars['String']['output']
  assetId: Scalars['BigInt']['output']
  assetAddress: Scalars['String']['output']
  assetAmount?: Maybe<Scalars['BigInt']['output']>
  assetPrice?: Maybe<Scalars['BigInt']['output']>
  escrowAddress: Scalars['String']['output']
  blockchain?: Maybe<Blockchain>
  holding?: Maybe<Holding>
  asset?: Maybe<Asset>
  escrow?: Maybe<Escrow>
}

export type Escrow = {
  __typename?: 'Escrow'
  address: Scalars['String']['output']
  poolId: Scalars['BigInt']['output']
  centrifugeId: Scalars['String']['output']
  blockchain?: Maybe<Blockchain>
  holdingEscrows?: Maybe<HoldingEscrowPage>
}

export type EscrowHoldingEscrowsArgs = {
  where?: InputMaybe<HoldingEscrowFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export type HoldingEscrowPage = {
  __typename?: 'HoldingEscrowPage'
  items: Array<HoldingEscrow>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type HoldingEscrowFilter = {
  AND?: InputMaybe<Array<InputMaybe<HoldingEscrowFilter>>>
  OR?: InputMaybe<Array<InputMaybe<HoldingEscrowFilter>>>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetId?: InputMaybe<Scalars['BigInt']['input']>
  assetId_not?: InputMaybe<Scalars['BigInt']['input']>
  assetId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lte?: InputMaybe<Scalars['BigInt']['input']>
  assetAddress?: InputMaybe<Scalars['String']['input']>
  assetAddress_not?: InputMaybe<Scalars['String']['input']>
  assetAddress_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  assetAddress_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  assetAddress_contains?: InputMaybe<Scalars['String']['input']>
  assetAddress_not_contains?: InputMaybe<Scalars['String']['input']>
  assetAddress_starts_with?: InputMaybe<Scalars['String']['input']>
  assetAddress_ends_with?: InputMaybe<Scalars['String']['input']>
  assetAddress_not_starts_with?: InputMaybe<Scalars['String']['input']>
  assetAddress_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetAmount?: InputMaybe<Scalars['BigInt']['input']>
  assetAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  assetAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  assetPrice?: InputMaybe<Scalars['BigInt']['input']>
  assetPrice_not?: InputMaybe<Scalars['BigInt']['input']>
  assetPrice_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetPrice_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetPrice_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetPrice_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetPrice_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetPrice_lte?: InputMaybe<Scalars['BigInt']['input']>
  escrowAddress?: InputMaybe<Scalars['String']['input']>
  escrowAddress_not?: InputMaybe<Scalars['String']['input']>
  escrowAddress_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  escrowAddress_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  escrowAddress_contains?: InputMaybe<Scalars['String']['input']>
  escrowAddress_not_contains?: InputMaybe<Scalars['String']['input']>
  escrowAddress_starts_with?: InputMaybe<Scalars['String']['input']>
  escrowAddress_ends_with?: InputMaybe<Scalars['String']['input']>
  escrowAddress_not_starts_with?: InputMaybe<Scalars['String']['input']>
  escrowAddress_not_ends_with?: InputMaybe<Scalars['String']['input']>
}

export type HoldingFilter = {
  AND?: InputMaybe<Array<InputMaybe<HoldingFilter>>>
  OR?: InputMaybe<Array<InputMaybe<HoldingFilter>>>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  isInitialized?: InputMaybe<Scalars['Boolean']['input']>
  isInitialized_not?: InputMaybe<Scalars['Boolean']['input']>
  isInitialized_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  isInitialized_not_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  isLiability?: InputMaybe<Scalars['Boolean']['input']>
  isLiability_not?: InputMaybe<Scalars['Boolean']['input']>
  isLiability_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  isLiability_not_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  valuation?: InputMaybe<Scalars['String']['input']>
  valuation_not?: InputMaybe<Scalars['String']['input']>
  valuation_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  valuation_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  valuation_contains?: InputMaybe<Scalars['String']['input']>
  valuation_not_contains?: InputMaybe<Scalars['String']['input']>
  valuation_starts_with?: InputMaybe<Scalars['String']['input']>
  valuation_ends_with?: InputMaybe<Scalars['String']['input']>
  valuation_not_starts_with?: InputMaybe<Scalars['String']['input']>
  valuation_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetId?: InputMaybe<Scalars['BigInt']['input']>
  assetId_not?: InputMaybe<Scalars['BigInt']['input']>
  assetId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lte?: InputMaybe<Scalars['BigInt']['input']>
  assetQuantity?: InputMaybe<Scalars['BigInt']['input']>
  assetQuantity_not?: InputMaybe<Scalars['BigInt']['input']>
  assetQuantity_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetQuantity_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetQuantity_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetQuantity_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetQuantity_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetQuantity_lte?: InputMaybe<Scalars['BigInt']['input']>
  totalValue?: InputMaybe<Scalars['BigInt']['input']>
  totalValue_not?: InputMaybe<Scalars['BigInt']['input']>
  totalValue_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  totalValue_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  totalValue_gt?: InputMaybe<Scalars['BigInt']['input']>
  totalValue_lt?: InputMaybe<Scalars['BigInt']['input']>
  totalValue_gte?: InputMaybe<Scalars['BigInt']['input']>
  totalValue_lte?: InputMaybe<Scalars['BigInt']['input']>
  updatedAt?: InputMaybe<Scalars['String']['input']>
  updatedAt_not?: InputMaybe<Scalars['String']['input']>
  updatedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  updatedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  updatedAt_contains?: InputMaybe<Scalars['String']['input']>
  updatedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  updatedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  updatedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  updatedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  updatedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  updatedAtBlock?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  updatedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  updatedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
}

export type EscrowPage = {
  __typename?: 'EscrowPage'
  items: Array<Escrow>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type EscrowFilter = {
  AND?: InputMaybe<Array<InputMaybe<EscrowFilter>>>
  OR?: InputMaybe<Array<InputMaybe<EscrowFilter>>>
  address?: InputMaybe<Scalars['String']['input']>
  address_not?: InputMaybe<Scalars['String']['input']>
  address_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  address_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  address_contains?: InputMaybe<Scalars['String']['input']>
  address_not_contains?: InputMaybe<Scalars['String']['input']>
  address_starts_with?: InputMaybe<Scalars['String']['input']>
  address_ends_with?: InputMaybe<Scalars['String']['input']>
  address_not_starts_with?: InputMaybe<Scalars['String']['input']>
  address_not_ends_with?: InputMaybe<Scalars['String']['input']>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
}

export type BlockchainPage = {
  __typename?: 'BlockchainPage'
  items: Array<Blockchain>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type BlockchainFilter = {
  AND?: InputMaybe<Array<InputMaybe<BlockchainFilter>>>
  OR?: InputMaybe<Array<InputMaybe<BlockchainFilter>>>
  id?: InputMaybe<Scalars['String']['input']>
  id_not?: InputMaybe<Scalars['String']['input']>
  id_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  id_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  id_contains?: InputMaybe<Scalars['String']['input']>
  id_not_contains?: InputMaybe<Scalars['String']['input']>
  id_starts_with?: InputMaybe<Scalars['String']['input']>
  id_ends_with?: InputMaybe<Scalars['String']['input']>
  id_not_starts_with?: InputMaybe<Scalars['String']['input']>
  id_not_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  network?: InputMaybe<Scalars['String']['input']>
  network_not?: InputMaybe<Scalars['String']['input']>
  network_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  network_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  network_contains?: InputMaybe<Scalars['String']['input']>
  network_not_contains?: InputMaybe<Scalars['String']['input']>
  network_starts_with?: InputMaybe<Scalars['String']['input']>
  network_ends_with?: InputMaybe<Scalars['String']['input']>
  network_not_starts_with?: InputMaybe<Scalars['String']['input']>
  network_not_ends_with?: InputMaybe<Scalars['String']['input']>
  lastPeriodStart?: InputMaybe<Scalars['String']['input']>
  lastPeriodStart_not?: InputMaybe<Scalars['String']['input']>
  lastPeriodStart_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  lastPeriodStart_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  lastPeriodStart_contains?: InputMaybe<Scalars['String']['input']>
  lastPeriodStart_not_contains?: InputMaybe<Scalars['String']['input']>
  lastPeriodStart_starts_with?: InputMaybe<Scalars['String']['input']>
  lastPeriodStart_ends_with?: InputMaybe<Scalars['String']['input']>
  lastPeriodStart_not_starts_with?: InputMaybe<Scalars['String']['input']>
  lastPeriodStart_not_ends_with?: InputMaybe<Scalars['String']['input']>
}

export type Deployment = {
  __typename?: 'Deployment'
  chainId: Scalars['String']['output']
  centrifugeId: Scalars['String']['output']
  root?: Maybe<Scalars['String']['output']>
  guardian?: Maybe<Scalars['String']['output']>
  gasService?: Maybe<Scalars['String']['output']>
  gateway?: Maybe<Scalars['String']['output']>
  multiAdapter?: Maybe<Scalars['String']['output']>
  messageProcessor?: Maybe<Scalars['String']['output']>
  messageDispatcher?: Maybe<Scalars['String']['output']>
  hubRegistry?: Maybe<Scalars['String']['output']>
  accounting?: Maybe<Scalars['String']['output']>
  holdings?: Maybe<Scalars['String']['output']>
  shareClassManager?: Maybe<Scalars['String']['output']>
  hub?: Maybe<Scalars['String']['output']>
  identityValuation?: Maybe<Scalars['String']['output']>
  poolEscrowFactory?: Maybe<Scalars['String']['output']>
  routerEscrow?: Maybe<Scalars['String']['output']>
  globalEscrow?: Maybe<Scalars['String']['output']>
  freezeOnlyHook?: Maybe<Scalars['String']['output']>
  redemptionRestrictionsHook?: Maybe<Scalars['String']['output']>
  fullRestrictionsHook?: Maybe<Scalars['String']['output']>
  tokenFactory?: Maybe<Scalars['String']['output']>
  asyncRequestManager?: Maybe<Scalars['String']['output']>
  syncManager?: Maybe<Scalars['String']['output']>
  asyncVaultFactory?: Maybe<Scalars['String']['output']>
  syncDepositVaultFactory?: Maybe<Scalars['String']['output']>
  spoke?: Maybe<Scalars['String']['output']>
  vaultRouter?: Maybe<Scalars['String']['output']>
  balanceSheet?: Maybe<Scalars['String']['output']>
  wormholeAdapter?: Maybe<Scalars['String']['output']>
  axelarAdapter?: Maybe<Scalars['String']['output']>
  blockchain?: Maybe<Blockchain>
}

export type DeploymentPage = {
  __typename?: 'DeploymentPage'
  items: Array<Deployment>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type DeploymentFilter = {
  AND?: InputMaybe<Array<InputMaybe<DeploymentFilter>>>
  OR?: InputMaybe<Array<InputMaybe<DeploymentFilter>>>
  chainId?: InputMaybe<Scalars['String']['input']>
  chainId_not?: InputMaybe<Scalars['String']['input']>
  chainId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  chainId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  chainId_contains?: InputMaybe<Scalars['String']['input']>
  chainId_not_contains?: InputMaybe<Scalars['String']['input']>
  chainId_starts_with?: InputMaybe<Scalars['String']['input']>
  chainId_ends_with?: InputMaybe<Scalars['String']['input']>
  chainId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  chainId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  root?: InputMaybe<Scalars['String']['input']>
  root_not?: InputMaybe<Scalars['String']['input']>
  root_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  root_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  root_contains?: InputMaybe<Scalars['String']['input']>
  root_not_contains?: InputMaybe<Scalars['String']['input']>
  root_starts_with?: InputMaybe<Scalars['String']['input']>
  root_ends_with?: InputMaybe<Scalars['String']['input']>
  root_not_starts_with?: InputMaybe<Scalars['String']['input']>
  root_not_ends_with?: InputMaybe<Scalars['String']['input']>
  guardian?: InputMaybe<Scalars['String']['input']>
  guardian_not?: InputMaybe<Scalars['String']['input']>
  guardian_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  guardian_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  guardian_contains?: InputMaybe<Scalars['String']['input']>
  guardian_not_contains?: InputMaybe<Scalars['String']['input']>
  guardian_starts_with?: InputMaybe<Scalars['String']['input']>
  guardian_ends_with?: InputMaybe<Scalars['String']['input']>
  guardian_not_starts_with?: InputMaybe<Scalars['String']['input']>
  guardian_not_ends_with?: InputMaybe<Scalars['String']['input']>
  gasService?: InputMaybe<Scalars['String']['input']>
  gasService_not?: InputMaybe<Scalars['String']['input']>
  gasService_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  gasService_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  gasService_contains?: InputMaybe<Scalars['String']['input']>
  gasService_not_contains?: InputMaybe<Scalars['String']['input']>
  gasService_starts_with?: InputMaybe<Scalars['String']['input']>
  gasService_ends_with?: InputMaybe<Scalars['String']['input']>
  gasService_not_starts_with?: InputMaybe<Scalars['String']['input']>
  gasService_not_ends_with?: InputMaybe<Scalars['String']['input']>
  gateway?: InputMaybe<Scalars['String']['input']>
  gateway_not?: InputMaybe<Scalars['String']['input']>
  gateway_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  gateway_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  gateway_contains?: InputMaybe<Scalars['String']['input']>
  gateway_not_contains?: InputMaybe<Scalars['String']['input']>
  gateway_starts_with?: InputMaybe<Scalars['String']['input']>
  gateway_ends_with?: InputMaybe<Scalars['String']['input']>
  gateway_not_starts_with?: InputMaybe<Scalars['String']['input']>
  gateway_not_ends_with?: InputMaybe<Scalars['String']['input']>
  multiAdapter?: InputMaybe<Scalars['String']['input']>
  multiAdapter_not?: InputMaybe<Scalars['String']['input']>
  multiAdapter_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  multiAdapter_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  multiAdapter_contains?: InputMaybe<Scalars['String']['input']>
  multiAdapter_not_contains?: InputMaybe<Scalars['String']['input']>
  multiAdapter_starts_with?: InputMaybe<Scalars['String']['input']>
  multiAdapter_ends_with?: InputMaybe<Scalars['String']['input']>
  multiAdapter_not_starts_with?: InputMaybe<Scalars['String']['input']>
  multiAdapter_not_ends_with?: InputMaybe<Scalars['String']['input']>
  messageProcessor?: InputMaybe<Scalars['String']['input']>
  messageProcessor_not?: InputMaybe<Scalars['String']['input']>
  messageProcessor_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  messageProcessor_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  messageProcessor_contains?: InputMaybe<Scalars['String']['input']>
  messageProcessor_not_contains?: InputMaybe<Scalars['String']['input']>
  messageProcessor_starts_with?: InputMaybe<Scalars['String']['input']>
  messageProcessor_ends_with?: InputMaybe<Scalars['String']['input']>
  messageProcessor_not_starts_with?: InputMaybe<Scalars['String']['input']>
  messageProcessor_not_ends_with?: InputMaybe<Scalars['String']['input']>
  messageDispatcher?: InputMaybe<Scalars['String']['input']>
  messageDispatcher_not?: InputMaybe<Scalars['String']['input']>
  messageDispatcher_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  messageDispatcher_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  messageDispatcher_contains?: InputMaybe<Scalars['String']['input']>
  messageDispatcher_not_contains?: InputMaybe<Scalars['String']['input']>
  messageDispatcher_starts_with?: InputMaybe<Scalars['String']['input']>
  messageDispatcher_ends_with?: InputMaybe<Scalars['String']['input']>
  messageDispatcher_not_starts_with?: InputMaybe<Scalars['String']['input']>
  messageDispatcher_not_ends_with?: InputMaybe<Scalars['String']['input']>
  hubRegistry?: InputMaybe<Scalars['String']['input']>
  hubRegistry_not?: InputMaybe<Scalars['String']['input']>
  hubRegistry_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  hubRegistry_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  hubRegistry_contains?: InputMaybe<Scalars['String']['input']>
  hubRegistry_not_contains?: InputMaybe<Scalars['String']['input']>
  hubRegistry_starts_with?: InputMaybe<Scalars['String']['input']>
  hubRegistry_ends_with?: InputMaybe<Scalars['String']['input']>
  hubRegistry_not_starts_with?: InputMaybe<Scalars['String']['input']>
  hubRegistry_not_ends_with?: InputMaybe<Scalars['String']['input']>
  accounting?: InputMaybe<Scalars['String']['input']>
  accounting_not?: InputMaybe<Scalars['String']['input']>
  accounting_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  accounting_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  accounting_contains?: InputMaybe<Scalars['String']['input']>
  accounting_not_contains?: InputMaybe<Scalars['String']['input']>
  accounting_starts_with?: InputMaybe<Scalars['String']['input']>
  accounting_ends_with?: InputMaybe<Scalars['String']['input']>
  accounting_not_starts_with?: InputMaybe<Scalars['String']['input']>
  accounting_not_ends_with?: InputMaybe<Scalars['String']['input']>
  holdings?: InputMaybe<Scalars['String']['input']>
  holdings_not?: InputMaybe<Scalars['String']['input']>
  holdings_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  holdings_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  holdings_contains?: InputMaybe<Scalars['String']['input']>
  holdings_not_contains?: InputMaybe<Scalars['String']['input']>
  holdings_starts_with?: InputMaybe<Scalars['String']['input']>
  holdings_ends_with?: InputMaybe<Scalars['String']['input']>
  holdings_not_starts_with?: InputMaybe<Scalars['String']['input']>
  holdings_not_ends_with?: InputMaybe<Scalars['String']['input']>
  shareClassManager?: InputMaybe<Scalars['String']['input']>
  shareClassManager_not?: InputMaybe<Scalars['String']['input']>
  shareClassManager_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  shareClassManager_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  shareClassManager_contains?: InputMaybe<Scalars['String']['input']>
  shareClassManager_not_contains?: InputMaybe<Scalars['String']['input']>
  shareClassManager_starts_with?: InputMaybe<Scalars['String']['input']>
  shareClassManager_ends_with?: InputMaybe<Scalars['String']['input']>
  shareClassManager_not_starts_with?: InputMaybe<Scalars['String']['input']>
  shareClassManager_not_ends_with?: InputMaybe<Scalars['String']['input']>
  hub?: InputMaybe<Scalars['String']['input']>
  hub_not?: InputMaybe<Scalars['String']['input']>
  hub_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  hub_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  hub_contains?: InputMaybe<Scalars['String']['input']>
  hub_not_contains?: InputMaybe<Scalars['String']['input']>
  hub_starts_with?: InputMaybe<Scalars['String']['input']>
  hub_ends_with?: InputMaybe<Scalars['String']['input']>
  hub_not_starts_with?: InputMaybe<Scalars['String']['input']>
  hub_not_ends_with?: InputMaybe<Scalars['String']['input']>
  identityValuation?: InputMaybe<Scalars['String']['input']>
  identityValuation_not?: InputMaybe<Scalars['String']['input']>
  identityValuation_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  identityValuation_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  identityValuation_contains?: InputMaybe<Scalars['String']['input']>
  identityValuation_not_contains?: InputMaybe<Scalars['String']['input']>
  identityValuation_starts_with?: InputMaybe<Scalars['String']['input']>
  identityValuation_ends_with?: InputMaybe<Scalars['String']['input']>
  identityValuation_not_starts_with?: InputMaybe<Scalars['String']['input']>
  identityValuation_not_ends_with?: InputMaybe<Scalars['String']['input']>
  poolEscrowFactory?: InputMaybe<Scalars['String']['input']>
  poolEscrowFactory_not?: InputMaybe<Scalars['String']['input']>
  poolEscrowFactory_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  poolEscrowFactory_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  poolEscrowFactory_contains?: InputMaybe<Scalars['String']['input']>
  poolEscrowFactory_not_contains?: InputMaybe<Scalars['String']['input']>
  poolEscrowFactory_starts_with?: InputMaybe<Scalars['String']['input']>
  poolEscrowFactory_ends_with?: InputMaybe<Scalars['String']['input']>
  poolEscrowFactory_not_starts_with?: InputMaybe<Scalars['String']['input']>
  poolEscrowFactory_not_ends_with?: InputMaybe<Scalars['String']['input']>
  routerEscrow?: InputMaybe<Scalars['String']['input']>
  routerEscrow_not?: InputMaybe<Scalars['String']['input']>
  routerEscrow_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  routerEscrow_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  routerEscrow_contains?: InputMaybe<Scalars['String']['input']>
  routerEscrow_not_contains?: InputMaybe<Scalars['String']['input']>
  routerEscrow_starts_with?: InputMaybe<Scalars['String']['input']>
  routerEscrow_ends_with?: InputMaybe<Scalars['String']['input']>
  routerEscrow_not_starts_with?: InputMaybe<Scalars['String']['input']>
  routerEscrow_not_ends_with?: InputMaybe<Scalars['String']['input']>
  globalEscrow?: InputMaybe<Scalars['String']['input']>
  globalEscrow_not?: InputMaybe<Scalars['String']['input']>
  globalEscrow_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  globalEscrow_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  globalEscrow_contains?: InputMaybe<Scalars['String']['input']>
  globalEscrow_not_contains?: InputMaybe<Scalars['String']['input']>
  globalEscrow_starts_with?: InputMaybe<Scalars['String']['input']>
  globalEscrow_ends_with?: InputMaybe<Scalars['String']['input']>
  globalEscrow_not_starts_with?: InputMaybe<Scalars['String']['input']>
  globalEscrow_not_ends_with?: InputMaybe<Scalars['String']['input']>
  freezeOnlyHook?: InputMaybe<Scalars['String']['input']>
  freezeOnlyHook_not?: InputMaybe<Scalars['String']['input']>
  freezeOnlyHook_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  freezeOnlyHook_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  freezeOnlyHook_contains?: InputMaybe<Scalars['String']['input']>
  freezeOnlyHook_not_contains?: InputMaybe<Scalars['String']['input']>
  freezeOnlyHook_starts_with?: InputMaybe<Scalars['String']['input']>
  freezeOnlyHook_ends_with?: InputMaybe<Scalars['String']['input']>
  freezeOnlyHook_not_starts_with?: InputMaybe<Scalars['String']['input']>
  freezeOnlyHook_not_ends_with?: InputMaybe<Scalars['String']['input']>
  redemptionRestrictionsHook?: InputMaybe<Scalars['String']['input']>
  redemptionRestrictionsHook_not?: InputMaybe<Scalars['String']['input']>
  redemptionRestrictionsHook_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  redemptionRestrictionsHook_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  redemptionRestrictionsHook_contains?: InputMaybe<Scalars['String']['input']>
  redemptionRestrictionsHook_not_contains?: InputMaybe<Scalars['String']['input']>
  redemptionRestrictionsHook_starts_with?: InputMaybe<Scalars['String']['input']>
  redemptionRestrictionsHook_ends_with?: InputMaybe<Scalars['String']['input']>
  redemptionRestrictionsHook_not_starts_with?: InputMaybe<Scalars['String']['input']>
  redemptionRestrictionsHook_not_ends_with?: InputMaybe<Scalars['String']['input']>
  fullRestrictionsHook?: InputMaybe<Scalars['String']['input']>
  fullRestrictionsHook_not?: InputMaybe<Scalars['String']['input']>
  fullRestrictionsHook_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  fullRestrictionsHook_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  fullRestrictionsHook_contains?: InputMaybe<Scalars['String']['input']>
  fullRestrictionsHook_not_contains?: InputMaybe<Scalars['String']['input']>
  fullRestrictionsHook_starts_with?: InputMaybe<Scalars['String']['input']>
  fullRestrictionsHook_ends_with?: InputMaybe<Scalars['String']['input']>
  fullRestrictionsHook_not_starts_with?: InputMaybe<Scalars['String']['input']>
  fullRestrictionsHook_not_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenFactory?: InputMaybe<Scalars['String']['input']>
  tokenFactory_not?: InputMaybe<Scalars['String']['input']>
  tokenFactory_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenFactory_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenFactory_contains?: InputMaybe<Scalars['String']['input']>
  tokenFactory_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenFactory_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenFactory_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenFactory_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenFactory_not_ends_with?: InputMaybe<Scalars['String']['input']>
  asyncRequestManager?: InputMaybe<Scalars['String']['input']>
  asyncRequestManager_not?: InputMaybe<Scalars['String']['input']>
  asyncRequestManager_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  asyncRequestManager_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  asyncRequestManager_contains?: InputMaybe<Scalars['String']['input']>
  asyncRequestManager_not_contains?: InputMaybe<Scalars['String']['input']>
  asyncRequestManager_starts_with?: InputMaybe<Scalars['String']['input']>
  asyncRequestManager_ends_with?: InputMaybe<Scalars['String']['input']>
  asyncRequestManager_not_starts_with?: InputMaybe<Scalars['String']['input']>
  asyncRequestManager_not_ends_with?: InputMaybe<Scalars['String']['input']>
  syncManager?: InputMaybe<Scalars['String']['input']>
  syncManager_not?: InputMaybe<Scalars['String']['input']>
  syncManager_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  syncManager_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  syncManager_contains?: InputMaybe<Scalars['String']['input']>
  syncManager_not_contains?: InputMaybe<Scalars['String']['input']>
  syncManager_starts_with?: InputMaybe<Scalars['String']['input']>
  syncManager_ends_with?: InputMaybe<Scalars['String']['input']>
  syncManager_not_starts_with?: InputMaybe<Scalars['String']['input']>
  syncManager_not_ends_with?: InputMaybe<Scalars['String']['input']>
  asyncVaultFactory?: InputMaybe<Scalars['String']['input']>
  asyncVaultFactory_not?: InputMaybe<Scalars['String']['input']>
  asyncVaultFactory_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  asyncVaultFactory_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  asyncVaultFactory_contains?: InputMaybe<Scalars['String']['input']>
  asyncVaultFactory_not_contains?: InputMaybe<Scalars['String']['input']>
  asyncVaultFactory_starts_with?: InputMaybe<Scalars['String']['input']>
  asyncVaultFactory_ends_with?: InputMaybe<Scalars['String']['input']>
  asyncVaultFactory_not_starts_with?: InputMaybe<Scalars['String']['input']>
  asyncVaultFactory_not_ends_with?: InputMaybe<Scalars['String']['input']>
  syncDepositVaultFactory?: InputMaybe<Scalars['String']['input']>
  syncDepositVaultFactory_not?: InputMaybe<Scalars['String']['input']>
  syncDepositVaultFactory_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  syncDepositVaultFactory_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  syncDepositVaultFactory_contains?: InputMaybe<Scalars['String']['input']>
  syncDepositVaultFactory_not_contains?: InputMaybe<Scalars['String']['input']>
  syncDepositVaultFactory_starts_with?: InputMaybe<Scalars['String']['input']>
  syncDepositVaultFactory_ends_with?: InputMaybe<Scalars['String']['input']>
  syncDepositVaultFactory_not_starts_with?: InputMaybe<Scalars['String']['input']>
  syncDepositVaultFactory_not_ends_with?: InputMaybe<Scalars['String']['input']>
  spoke?: InputMaybe<Scalars['String']['input']>
  spoke_not?: InputMaybe<Scalars['String']['input']>
  spoke_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  spoke_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  spoke_contains?: InputMaybe<Scalars['String']['input']>
  spoke_not_contains?: InputMaybe<Scalars['String']['input']>
  spoke_starts_with?: InputMaybe<Scalars['String']['input']>
  spoke_ends_with?: InputMaybe<Scalars['String']['input']>
  spoke_not_starts_with?: InputMaybe<Scalars['String']['input']>
  spoke_not_ends_with?: InputMaybe<Scalars['String']['input']>
  vaultRouter?: InputMaybe<Scalars['String']['input']>
  vaultRouter_not?: InputMaybe<Scalars['String']['input']>
  vaultRouter_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  vaultRouter_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  vaultRouter_contains?: InputMaybe<Scalars['String']['input']>
  vaultRouter_not_contains?: InputMaybe<Scalars['String']['input']>
  vaultRouter_starts_with?: InputMaybe<Scalars['String']['input']>
  vaultRouter_ends_with?: InputMaybe<Scalars['String']['input']>
  vaultRouter_not_starts_with?: InputMaybe<Scalars['String']['input']>
  vaultRouter_not_ends_with?: InputMaybe<Scalars['String']['input']>
  balanceSheet?: InputMaybe<Scalars['String']['input']>
  balanceSheet_not?: InputMaybe<Scalars['String']['input']>
  balanceSheet_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  balanceSheet_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  balanceSheet_contains?: InputMaybe<Scalars['String']['input']>
  balanceSheet_not_contains?: InputMaybe<Scalars['String']['input']>
  balanceSheet_starts_with?: InputMaybe<Scalars['String']['input']>
  balanceSheet_ends_with?: InputMaybe<Scalars['String']['input']>
  balanceSheet_not_starts_with?: InputMaybe<Scalars['String']['input']>
  balanceSheet_not_ends_with?: InputMaybe<Scalars['String']['input']>
  wormholeAdapter?: InputMaybe<Scalars['String']['input']>
  wormholeAdapter_not?: InputMaybe<Scalars['String']['input']>
  wormholeAdapter_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  wormholeAdapter_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  wormholeAdapter_contains?: InputMaybe<Scalars['String']['input']>
  wormholeAdapter_not_contains?: InputMaybe<Scalars['String']['input']>
  wormholeAdapter_starts_with?: InputMaybe<Scalars['String']['input']>
  wormholeAdapter_ends_with?: InputMaybe<Scalars['String']['input']>
  wormholeAdapter_not_starts_with?: InputMaybe<Scalars['String']['input']>
  wormholeAdapter_not_ends_with?: InputMaybe<Scalars['String']['input']>
  axelarAdapter?: InputMaybe<Scalars['String']['input']>
  axelarAdapter_not?: InputMaybe<Scalars['String']['input']>
  axelarAdapter_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  axelarAdapter_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  axelarAdapter_contains?: InputMaybe<Scalars['String']['input']>
  axelarAdapter_not_contains?: InputMaybe<Scalars['String']['input']>
  axelarAdapter_starts_with?: InputMaybe<Scalars['String']['input']>
  axelarAdapter_ends_with?: InputMaybe<Scalars['String']['input']>
  axelarAdapter_not_starts_with?: InputMaybe<Scalars['String']['input']>
  axelarAdapter_not_ends_with?: InputMaybe<Scalars['String']['input']>
}

export type OutstandingRedeem = {
  __typename?: 'OutstandingRedeem'
  poolId: Scalars['BigInt']['output']
  tokenId: Scalars['String']['output']
  assetId: Scalars['BigInt']['output']
  account: Scalars['String']['output']
  pendingAmount?: Maybe<Scalars['BigInt']['output']>
  queuedAmount?: Maybe<Scalars['BigInt']['output']>
  depositAmount?: Maybe<Scalars['BigInt']['output']>
  approvedAmount?: Maybe<Scalars['BigInt']['output']>
  approvedAt?: Maybe<Scalars['String']['output']>
  approvedAtBlock?: Maybe<Scalars['Int']['output']>
  updatedAt?: Maybe<Scalars['String']['output']>
  updatedAtBlock?: Maybe<Scalars['Int']['output']>
  token?: Maybe<Token>
}

export type OutstandingRedeemPage = {
  __typename?: 'OutstandingRedeemPage'
  items: Array<OutstandingRedeem>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type OutstandingRedeemFilter = {
  AND?: InputMaybe<Array<InputMaybe<OutstandingRedeemFilter>>>
  OR?: InputMaybe<Array<InputMaybe<OutstandingRedeemFilter>>>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetId?: InputMaybe<Scalars['BigInt']['input']>
  assetId_not?: InputMaybe<Scalars['BigInt']['input']>
  assetId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lte?: InputMaybe<Scalars['BigInt']['input']>
  account?: InputMaybe<Scalars['String']['input']>
  account_not?: InputMaybe<Scalars['String']['input']>
  account_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  account_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  account_contains?: InputMaybe<Scalars['String']['input']>
  account_not_contains?: InputMaybe<Scalars['String']['input']>
  account_starts_with?: InputMaybe<Scalars['String']['input']>
  account_ends_with?: InputMaybe<Scalars['String']['input']>
  account_not_starts_with?: InputMaybe<Scalars['String']['input']>
  account_not_ends_with?: InputMaybe<Scalars['String']['input']>
  pendingAmount?: InputMaybe<Scalars['BigInt']['input']>
  pendingAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  pendingAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  pendingAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  pendingAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  pendingAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  pendingAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  pendingAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  queuedAmount?: InputMaybe<Scalars['BigInt']['input']>
  queuedAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  queuedAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  queuedAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  queuedAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  queuedAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  queuedAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  queuedAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  depositAmount?: InputMaybe<Scalars['BigInt']['input']>
  depositAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  depositAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  depositAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  depositAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  depositAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  depositAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  depositAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  approvedAmount?: InputMaybe<Scalars['BigInt']['input']>
  approvedAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  approvedAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  approvedAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  approvedAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  approvedAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  approvedAt?: InputMaybe<Scalars['String']['input']>
  approvedAt_not?: InputMaybe<Scalars['String']['input']>
  approvedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  approvedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  approvedAt_contains?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  approvedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  approvedAtBlock?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  approvedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  approvedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
  updatedAt?: InputMaybe<Scalars['String']['input']>
  updatedAt_not?: InputMaybe<Scalars['String']['input']>
  updatedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  updatedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  updatedAt_contains?: InputMaybe<Scalars['String']['input']>
  updatedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  updatedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  updatedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  updatedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  updatedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  updatedAtBlock?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  updatedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  updatedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
}

export type InvestOrder = {
  __typename?: 'InvestOrder'
  poolId: Scalars['BigInt']['output']
  tokenId: Scalars['String']['output']
  assetId: Scalars['BigInt']['output']
  account: Scalars['String']['output']
  index: Scalars['Int']['output']
  approvedAt?: Maybe<Scalars['String']['output']>
  approvedAtBlock?: Maybe<Scalars['Int']['output']>
  approvedAssetsAmount?: Maybe<Scalars['BigInt']['output']>
  issuedSharesAmount?: Maybe<Scalars['BigInt']['output']>
  issuedWithNavPoolPerShare?: Maybe<Scalars['BigInt']['output']>
  issuedWithNavAssetPerShare?: Maybe<Scalars['BigInt']['output']>
  issuedAt?: Maybe<Scalars['String']['output']>
  issuedAtBlock?: Maybe<Scalars['Int']['output']>
  claimedAt?: Maybe<Scalars['String']['output']>
  claimedAtBlock?: Maybe<Scalars['Int']['output']>
}

export type InvestOrderPage = {
  __typename?: 'InvestOrderPage'
  items: Array<InvestOrder>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type InvestOrderFilter = {
  AND?: InputMaybe<Array<InputMaybe<InvestOrderFilter>>>
  OR?: InputMaybe<Array<InputMaybe<InvestOrderFilter>>>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetId?: InputMaybe<Scalars['BigInt']['input']>
  assetId_not?: InputMaybe<Scalars['BigInt']['input']>
  assetId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lte?: InputMaybe<Scalars['BigInt']['input']>
  account?: InputMaybe<Scalars['String']['input']>
  account_not?: InputMaybe<Scalars['String']['input']>
  account_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  account_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  account_contains?: InputMaybe<Scalars['String']['input']>
  account_not_contains?: InputMaybe<Scalars['String']['input']>
  account_starts_with?: InputMaybe<Scalars['String']['input']>
  account_ends_with?: InputMaybe<Scalars['String']['input']>
  account_not_starts_with?: InputMaybe<Scalars['String']['input']>
  account_not_ends_with?: InputMaybe<Scalars['String']['input']>
  index?: InputMaybe<Scalars['Int']['input']>
  index_not?: InputMaybe<Scalars['Int']['input']>
  index_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  index_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  index_gt?: InputMaybe<Scalars['Int']['input']>
  index_lt?: InputMaybe<Scalars['Int']['input']>
  index_gte?: InputMaybe<Scalars['Int']['input']>
  index_lte?: InputMaybe<Scalars['Int']['input']>
  approvedAt?: InputMaybe<Scalars['String']['input']>
  approvedAt_not?: InputMaybe<Scalars['String']['input']>
  approvedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  approvedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  approvedAt_contains?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  approvedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  approvedAtBlock?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  approvedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  approvedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
  approvedAssetsAmount?: InputMaybe<Scalars['BigInt']['input']>
  approvedAssetsAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  approvedAssetsAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedAssetsAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedAssetsAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  approvedAssetsAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  approvedAssetsAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  approvedAssetsAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  issuedSharesAmount?: InputMaybe<Scalars['BigInt']['input']>
  issuedSharesAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  issuedSharesAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  issuedSharesAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  issuedSharesAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  issuedSharesAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  issuedSharesAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  issuedSharesAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavPoolPerShare?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavPoolPerShare_not?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavPoolPerShare_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  issuedWithNavPoolPerShare_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  issuedWithNavPoolPerShare_gt?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavPoolPerShare_lt?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavPoolPerShare_gte?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavPoolPerShare_lte?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavAssetPerShare?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavAssetPerShare_not?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavAssetPerShare_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  issuedWithNavAssetPerShare_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  issuedWithNavAssetPerShare_gt?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavAssetPerShare_lt?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavAssetPerShare_gte?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavAssetPerShare_lte?: InputMaybe<Scalars['BigInt']['input']>
  issuedAt?: InputMaybe<Scalars['String']['input']>
  issuedAt_not?: InputMaybe<Scalars['String']['input']>
  issuedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  issuedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  issuedAt_contains?: InputMaybe<Scalars['String']['input']>
  issuedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  issuedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  issuedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  issuedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  issuedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  issuedAtBlock?: InputMaybe<Scalars['Int']['input']>
  issuedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  issuedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  issuedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  issuedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  issuedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  issuedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  issuedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
  claimedAt?: InputMaybe<Scalars['String']['input']>
  claimedAt_not?: InputMaybe<Scalars['String']['input']>
  claimedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  claimedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  claimedAt_contains?: InputMaybe<Scalars['String']['input']>
  claimedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  claimedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  claimedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  claimedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  claimedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  claimedAtBlock?: InputMaybe<Scalars['Int']['input']>
  claimedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  claimedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  claimedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  claimedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  claimedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  claimedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  claimedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
}

export type RedeemOrder = {
  __typename?: 'RedeemOrder'
  poolId: Scalars['BigInt']['output']
  tokenId: Scalars['String']['output']
  assetId: Scalars['BigInt']['output']
  account: Scalars['String']['output']
  index: Scalars['Int']['output']
  approvedAt?: Maybe<Scalars['String']['output']>
  approvedAtBlock?: Maybe<Scalars['Int']['output']>
  approvedSharesAmount?: Maybe<Scalars['BigInt']['output']>
  revokedAt?: Maybe<Scalars['String']['output']>
  revokedAtBlock?: Maybe<Scalars['Int']['output']>
  revokedAssetsAmount?: Maybe<Scalars['BigInt']['output']>
  revokedPoolAmount?: Maybe<Scalars['BigInt']['output']>
  revokedWithNavPoolPerShare?: Maybe<Scalars['BigInt']['output']>
  revokedWithNavAssetPerShare?: Maybe<Scalars['BigInt']['output']>
  claimedAt?: Maybe<Scalars['String']['output']>
  claimedAtBlock?: Maybe<Scalars['Int']['output']>
}

export type RedeemOrderPage = {
  __typename?: 'RedeemOrderPage'
  items: Array<RedeemOrder>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type RedeemOrderFilter = {
  AND?: InputMaybe<Array<InputMaybe<RedeemOrderFilter>>>
  OR?: InputMaybe<Array<InputMaybe<RedeemOrderFilter>>>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetId?: InputMaybe<Scalars['BigInt']['input']>
  assetId_not?: InputMaybe<Scalars['BigInt']['input']>
  assetId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lte?: InputMaybe<Scalars['BigInt']['input']>
  account?: InputMaybe<Scalars['String']['input']>
  account_not?: InputMaybe<Scalars['String']['input']>
  account_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  account_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  account_contains?: InputMaybe<Scalars['String']['input']>
  account_not_contains?: InputMaybe<Scalars['String']['input']>
  account_starts_with?: InputMaybe<Scalars['String']['input']>
  account_ends_with?: InputMaybe<Scalars['String']['input']>
  account_not_starts_with?: InputMaybe<Scalars['String']['input']>
  account_not_ends_with?: InputMaybe<Scalars['String']['input']>
  index?: InputMaybe<Scalars['Int']['input']>
  index_not?: InputMaybe<Scalars['Int']['input']>
  index_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  index_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  index_gt?: InputMaybe<Scalars['Int']['input']>
  index_lt?: InputMaybe<Scalars['Int']['input']>
  index_gte?: InputMaybe<Scalars['Int']['input']>
  index_lte?: InputMaybe<Scalars['Int']['input']>
  approvedAt?: InputMaybe<Scalars['String']['input']>
  approvedAt_not?: InputMaybe<Scalars['String']['input']>
  approvedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  approvedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  approvedAt_contains?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  approvedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  approvedAtBlock?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  approvedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  approvedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
  approvedSharesAmount?: InputMaybe<Scalars['BigInt']['input']>
  approvedSharesAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  approvedSharesAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedSharesAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedSharesAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  approvedSharesAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  approvedSharesAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  approvedSharesAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  revokedAt?: InputMaybe<Scalars['String']['input']>
  revokedAt_not?: InputMaybe<Scalars['String']['input']>
  revokedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  revokedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  revokedAt_contains?: InputMaybe<Scalars['String']['input']>
  revokedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  revokedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  revokedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  revokedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  revokedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  revokedAtBlock?: InputMaybe<Scalars['Int']['input']>
  revokedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  revokedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  revokedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  revokedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  revokedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  revokedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  revokedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
  revokedAssetsAmount?: InputMaybe<Scalars['BigInt']['input']>
  revokedAssetsAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  revokedAssetsAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedAssetsAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedAssetsAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  revokedAssetsAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  revokedAssetsAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  revokedAssetsAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  revokedPoolAmount?: InputMaybe<Scalars['BigInt']['input']>
  revokedPoolAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  revokedPoolAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedPoolAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedPoolAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  revokedPoolAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  revokedPoolAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  revokedPoolAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavPoolPerShare?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavPoolPerShare_not?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavPoolPerShare_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedWithNavPoolPerShare_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedWithNavPoolPerShare_gt?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavPoolPerShare_lt?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavPoolPerShare_gte?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavPoolPerShare_lte?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavAssetPerShare?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavAssetPerShare_not?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavAssetPerShare_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedWithNavAssetPerShare_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedWithNavAssetPerShare_gt?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavAssetPerShare_lt?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavAssetPerShare_gte?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavAssetPerShare_lte?: InputMaybe<Scalars['BigInt']['input']>
  claimedAt?: InputMaybe<Scalars['String']['input']>
  claimedAt_not?: InputMaybe<Scalars['String']['input']>
  claimedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  claimedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  claimedAt_contains?: InputMaybe<Scalars['String']['input']>
  claimedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  claimedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  claimedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  claimedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  claimedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  claimedAtBlock?: InputMaybe<Scalars['Int']['input']>
  claimedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  claimedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  claimedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  claimedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  claimedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  claimedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  claimedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
}

export type EpochOutstandingInvest = {
  __typename?: 'EpochOutstandingInvest'
  poolId: Scalars['BigInt']['output']
  tokenId: Scalars['String']['output']
  assetId: Scalars['BigInt']['output']
  pendingAssetsAmount?: Maybe<Scalars['BigInt']['output']>
  updatedAt?: Maybe<Scalars['String']['output']>
  updatedAtBlock?: Maybe<Scalars['Int']['output']>
}

export type EpochOutstandingInvestPage = {
  __typename?: 'EpochOutstandingInvestPage'
  items: Array<EpochOutstandingInvest>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type EpochOutstandingInvestFilter = {
  AND?: InputMaybe<Array<InputMaybe<EpochOutstandingInvestFilter>>>
  OR?: InputMaybe<Array<InputMaybe<EpochOutstandingInvestFilter>>>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetId?: InputMaybe<Scalars['BigInt']['input']>
  assetId_not?: InputMaybe<Scalars['BigInt']['input']>
  assetId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lte?: InputMaybe<Scalars['BigInt']['input']>
  pendingAssetsAmount?: InputMaybe<Scalars['BigInt']['input']>
  pendingAssetsAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  pendingAssetsAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  pendingAssetsAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  pendingAssetsAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  pendingAssetsAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  pendingAssetsAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  pendingAssetsAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  updatedAt?: InputMaybe<Scalars['String']['input']>
  updatedAt_not?: InputMaybe<Scalars['String']['input']>
  updatedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  updatedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  updatedAt_contains?: InputMaybe<Scalars['String']['input']>
  updatedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  updatedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  updatedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  updatedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  updatedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  updatedAtBlock?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  updatedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  updatedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
}

export type EpochOutstandingRedeem = {
  __typename?: 'EpochOutstandingRedeem'
  poolId: Scalars['BigInt']['output']
  tokenId: Scalars['String']['output']
  assetId: Scalars['BigInt']['output']
  pendingSharesAmount?: Maybe<Scalars['BigInt']['output']>
  updatedAt?: Maybe<Scalars['String']['output']>
  updatedAtBlock?: Maybe<Scalars['Int']['output']>
}

export type EpochOutstandingRedeemPage = {
  __typename?: 'EpochOutstandingRedeemPage'
  items: Array<EpochOutstandingRedeem>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type EpochOutstandingRedeemFilter = {
  AND?: InputMaybe<Array<InputMaybe<EpochOutstandingRedeemFilter>>>
  OR?: InputMaybe<Array<InputMaybe<EpochOutstandingRedeemFilter>>>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetId?: InputMaybe<Scalars['BigInt']['input']>
  assetId_not?: InputMaybe<Scalars['BigInt']['input']>
  assetId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lte?: InputMaybe<Scalars['BigInt']['input']>
  pendingSharesAmount?: InputMaybe<Scalars['BigInt']['input']>
  pendingSharesAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  pendingSharesAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  pendingSharesAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  pendingSharesAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  pendingSharesAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  pendingSharesAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  pendingSharesAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  updatedAt?: InputMaybe<Scalars['String']['input']>
  updatedAt_not?: InputMaybe<Scalars['String']['input']>
  updatedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  updatedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  updatedAt_contains?: InputMaybe<Scalars['String']['input']>
  updatedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  updatedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  updatedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  updatedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  updatedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  updatedAtBlock?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  updatedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  updatedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  updatedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
}

export type EpochInvestOrder = {
  __typename?: 'EpochInvestOrder'
  poolId: Scalars['BigInt']['output']
  tokenId: Scalars['String']['output']
  assetId: Scalars['BigInt']['output']
  index: Scalars['Int']['output']
  approvedAt?: Maybe<Scalars['String']['output']>
  approvedAtBlock?: Maybe<Scalars['Int']['output']>
  approvedAssetsAmount?: Maybe<Scalars['BigInt']['output']>
  approvedPoolAmount?: Maybe<Scalars['BigInt']['output']>
  approvedPercentageOfTotalPending?: Maybe<Scalars['BigInt']['output']>
  issuedAt?: Maybe<Scalars['String']['output']>
  issuedAtBlock?: Maybe<Scalars['Int']['output']>
  issuedSharesAmount?: Maybe<Scalars['BigInt']['output']>
  issuedWithNavPoolPerShare?: Maybe<Scalars['BigInt']['output']>
  issuedWithNavAssetPerShare?: Maybe<Scalars['BigInt']['output']>
}

export type EpochInvestOrderPage = {
  __typename?: 'EpochInvestOrderPage'
  items: Array<EpochInvestOrder>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type EpochInvestOrderFilter = {
  AND?: InputMaybe<Array<InputMaybe<EpochInvestOrderFilter>>>
  OR?: InputMaybe<Array<InputMaybe<EpochInvestOrderFilter>>>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetId?: InputMaybe<Scalars['BigInt']['input']>
  assetId_not?: InputMaybe<Scalars['BigInt']['input']>
  assetId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lte?: InputMaybe<Scalars['BigInt']['input']>
  index?: InputMaybe<Scalars['Int']['input']>
  index_not?: InputMaybe<Scalars['Int']['input']>
  index_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  index_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  index_gt?: InputMaybe<Scalars['Int']['input']>
  index_lt?: InputMaybe<Scalars['Int']['input']>
  index_gte?: InputMaybe<Scalars['Int']['input']>
  index_lte?: InputMaybe<Scalars['Int']['input']>
  approvedAt?: InputMaybe<Scalars['String']['input']>
  approvedAt_not?: InputMaybe<Scalars['String']['input']>
  approvedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  approvedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  approvedAt_contains?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  approvedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  approvedAtBlock?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  approvedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  approvedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
  approvedAssetsAmount?: InputMaybe<Scalars['BigInt']['input']>
  approvedAssetsAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  approvedAssetsAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedAssetsAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedAssetsAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  approvedAssetsAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  approvedAssetsAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  approvedAssetsAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  approvedPoolAmount?: InputMaybe<Scalars['BigInt']['input']>
  approvedPoolAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  approvedPoolAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedPoolAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedPoolAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  approvedPoolAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  approvedPoolAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  approvedPoolAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  approvedPercentageOfTotalPending?: InputMaybe<Scalars['BigInt']['input']>
  approvedPercentageOfTotalPending_not?: InputMaybe<Scalars['BigInt']['input']>
  approvedPercentageOfTotalPending_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedPercentageOfTotalPending_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedPercentageOfTotalPending_gt?: InputMaybe<Scalars['BigInt']['input']>
  approvedPercentageOfTotalPending_lt?: InputMaybe<Scalars['BigInt']['input']>
  approvedPercentageOfTotalPending_gte?: InputMaybe<Scalars['BigInt']['input']>
  approvedPercentageOfTotalPending_lte?: InputMaybe<Scalars['BigInt']['input']>
  issuedAt?: InputMaybe<Scalars['String']['input']>
  issuedAt_not?: InputMaybe<Scalars['String']['input']>
  issuedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  issuedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  issuedAt_contains?: InputMaybe<Scalars['String']['input']>
  issuedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  issuedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  issuedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  issuedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  issuedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  issuedAtBlock?: InputMaybe<Scalars['Int']['input']>
  issuedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  issuedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  issuedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  issuedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  issuedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  issuedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  issuedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
  issuedSharesAmount?: InputMaybe<Scalars['BigInt']['input']>
  issuedSharesAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  issuedSharesAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  issuedSharesAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  issuedSharesAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  issuedSharesAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  issuedSharesAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  issuedSharesAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavPoolPerShare?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavPoolPerShare_not?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavPoolPerShare_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  issuedWithNavPoolPerShare_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  issuedWithNavPoolPerShare_gt?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavPoolPerShare_lt?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavPoolPerShare_gte?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavPoolPerShare_lte?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavAssetPerShare?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavAssetPerShare_not?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavAssetPerShare_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  issuedWithNavAssetPerShare_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  issuedWithNavAssetPerShare_gt?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavAssetPerShare_lt?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavAssetPerShare_gte?: InputMaybe<Scalars['BigInt']['input']>
  issuedWithNavAssetPerShare_lte?: InputMaybe<Scalars['BigInt']['input']>
}

export type EpochRedeemOrder = {
  __typename?: 'EpochRedeemOrder'
  poolId: Scalars['BigInt']['output']
  tokenId: Scalars['String']['output']
  assetId: Scalars['BigInt']['output']
  index: Scalars['Int']['output']
  approvedAt?: Maybe<Scalars['String']['output']>
  approvedAtBlock?: Maybe<Scalars['Int']['output']>
  approvedAssetsAmount?: Maybe<Scalars['BigInt']['output']>
  approvedPoolAmount?: Maybe<Scalars['BigInt']['output']>
  approvedPercentageOfTotalPending?: Maybe<Scalars['BigInt']['output']>
  revokedAt?: Maybe<Scalars['String']['output']>
  revokedAtBlock?: Maybe<Scalars['Int']['output']>
  revokedSharesAmount?: Maybe<Scalars['BigInt']['output']>
  revokedAssetsAmount?: Maybe<Scalars['BigInt']['output']>
  revokedPoolAmount?: Maybe<Scalars['BigInt']['output']>
  revokedWithNavPoolPerShare?: Maybe<Scalars['BigInt']['output']>
  revokedWithNavAssetPerShare?: Maybe<Scalars['BigInt']['output']>
}

export type EpochRedeemOrderPage = {
  __typename?: 'EpochRedeemOrderPage'
  items: Array<EpochRedeemOrder>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type EpochRedeemOrderFilter = {
  AND?: InputMaybe<Array<InputMaybe<EpochRedeemOrderFilter>>>
  OR?: InputMaybe<Array<InputMaybe<EpochRedeemOrderFilter>>>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetId?: InputMaybe<Scalars['BigInt']['input']>
  assetId_not?: InputMaybe<Scalars['BigInt']['input']>
  assetId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lte?: InputMaybe<Scalars['BigInt']['input']>
  index?: InputMaybe<Scalars['Int']['input']>
  index_not?: InputMaybe<Scalars['Int']['input']>
  index_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  index_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  index_gt?: InputMaybe<Scalars['Int']['input']>
  index_lt?: InputMaybe<Scalars['Int']['input']>
  index_gte?: InputMaybe<Scalars['Int']['input']>
  index_lte?: InputMaybe<Scalars['Int']['input']>
  approvedAt?: InputMaybe<Scalars['String']['input']>
  approvedAt_not?: InputMaybe<Scalars['String']['input']>
  approvedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  approvedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  approvedAt_contains?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  approvedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  approvedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  approvedAtBlock?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  approvedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  approvedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  approvedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
  approvedAssetsAmount?: InputMaybe<Scalars['BigInt']['input']>
  approvedAssetsAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  approvedAssetsAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedAssetsAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedAssetsAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  approvedAssetsAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  approvedAssetsAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  approvedAssetsAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  approvedPoolAmount?: InputMaybe<Scalars['BigInt']['input']>
  approvedPoolAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  approvedPoolAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedPoolAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedPoolAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  approvedPoolAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  approvedPoolAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  approvedPoolAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  approvedPercentageOfTotalPending?: InputMaybe<Scalars['BigInt']['input']>
  approvedPercentageOfTotalPending_not?: InputMaybe<Scalars['BigInt']['input']>
  approvedPercentageOfTotalPending_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedPercentageOfTotalPending_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  approvedPercentageOfTotalPending_gt?: InputMaybe<Scalars['BigInt']['input']>
  approvedPercentageOfTotalPending_lt?: InputMaybe<Scalars['BigInt']['input']>
  approvedPercentageOfTotalPending_gte?: InputMaybe<Scalars['BigInt']['input']>
  approvedPercentageOfTotalPending_lte?: InputMaybe<Scalars['BigInt']['input']>
  revokedAt?: InputMaybe<Scalars['String']['input']>
  revokedAt_not?: InputMaybe<Scalars['String']['input']>
  revokedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  revokedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  revokedAt_contains?: InputMaybe<Scalars['String']['input']>
  revokedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  revokedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  revokedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  revokedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  revokedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  revokedAtBlock?: InputMaybe<Scalars['Int']['input']>
  revokedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  revokedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  revokedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  revokedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  revokedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  revokedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  revokedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
  revokedSharesAmount?: InputMaybe<Scalars['BigInt']['input']>
  revokedSharesAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  revokedSharesAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedSharesAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedSharesAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  revokedSharesAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  revokedSharesAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  revokedSharesAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  revokedAssetsAmount?: InputMaybe<Scalars['BigInt']['input']>
  revokedAssetsAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  revokedAssetsAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedAssetsAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedAssetsAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  revokedAssetsAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  revokedAssetsAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  revokedAssetsAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  revokedPoolAmount?: InputMaybe<Scalars['BigInt']['input']>
  revokedPoolAmount_not?: InputMaybe<Scalars['BigInt']['input']>
  revokedPoolAmount_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedPoolAmount_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedPoolAmount_gt?: InputMaybe<Scalars['BigInt']['input']>
  revokedPoolAmount_lt?: InputMaybe<Scalars['BigInt']['input']>
  revokedPoolAmount_gte?: InputMaybe<Scalars['BigInt']['input']>
  revokedPoolAmount_lte?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavPoolPerShare?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavPoolPerShare_not?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavPoolPerShare_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedWithNavPoolPerShare_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedWithNavPoolPerShare_gt?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavPoolPerShare_lt?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavPoolPerShare_gte?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavPoolPerShare_lte?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavAssetPerShare?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavAssetPerShare_not?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavAssetPerShare_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedWithNavAssetPerShare_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  revokedWithNavAssetPerShare_gt?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavAssetPerShare_lt?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavAssetPerShare_gte?: InputMaybe<Scalars['BigInt']['input']>
  revokedWithNavAssetPerShare_lte?: InputMaybe<Scalars['BigInt']['input']>
}

export type HoldingAccount = {
  __typename?: 'HoldingAccount'
  id: Scalars['String']['output']
  tokenId: Scalars['String']['output']
  kind: HoldingAccountType
  holding?: Maybe<Holding>
}

export enum HoldingAccountType {
  Asset = 'Asset',
  Equity = 'Equity',
  Loss = 'Loss',
  Gain = 'Gain',
  Expense = 'Expense',
  Liability = 'Liability',
}

export type HoldingAccountPage = {
  __typename?: 'HoldingAccountPage'
  items: Array<HoldingAccount>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type HoldingAccountFilter = {
  AND?: InputMaybe<Array<InputMaybe<HoldingAccountFilter>>>
  OR?: InputMaybe<Array<InputMaybe<HoldingAccountFilter>>>
  id?: InputMaybe<Scalars['String']['input']>
  id_not?: InputMaybe<Scalars['String']['input']>
  id_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  id_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  id_contains?: InputMaybe<Scalars['String']['input']>
  id_not_contains?: InputMaybe<Scalars['String']['input']>
  id_starts_with?: InputMaybe<Scalars['String']['input']>
  id_ends_with?: InputMaybe<Scalars['String']['input']>
  id_not_starts_with?: InputMaybe<Scalars['String']['input']>
  id_not_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  kind?: InputMaybe<HoldingAccountType>
  kind_not?: InputMaybe<HoldingAccountType>
  kind_in?: InputMaybe<Array<InputMaybe<HoldingAccountType>>>
  kind_not_in?: InputMaybe<Array<InputMaybe<HoldingAccountType>>>
}

export type OfframpRelayer = {
  __typename?: 'OfframpRelayer'
  address: Scalars['String']['output']
  isEnabled: Scalars['Boolean']['output']
}

export type OfframpRelayerPage = {
  __typename?: 'OfframpRelayerPage'
  items: Array<OfframpRelayer>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type OfframpRelayerFilter = {
  AND?: InputMaybe<Array<InputMaybe<OfframpRelayerFilter>>>
  OR?: InputMaybe<Array<InputMaybe<OfframpRelayerFilter>>>
  address?: InputMaybe<Scalars['String']['input']>
  address_not?: InputMaybe<Scalars['String']['input']>
  address_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  address_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  address_contains?: InputMaybe<Scalars['String']['input']>
  address_not_contains?: InputMaybe<Scalars['String']['input']>
  address_starts_with?: InputMaybe<Scalars['String']['input']>
  address_ends_with?: InputMaybe<Scalars['String']['input']>
  address_not_starts_with?: InputMaybe<Scalars['String']['input']>
  address_not_ends_with?: InputMaybe<Scalars['String']['input']>
  isEnabled?: InputMaybe<Scalars['Boolean']['input']>
  isEnabled_not?: InputMaybe<Scalars['Boolean']['input']>
  isEnabled_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
  isEnabled_not_in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>
}

export type CrosschainPayload = {
  __typename?: 'CrosschainPayload'
  id: Scalars['String']['output']
  fromCentrifugeId: Scalars['String']['output']
  toCentrifugeId: Scalars['String']['output']
  poolId?: Maybe<Scalars['BigInt']['output']>
  votes: Scalars['Int']['output']
  status: CrosschainPayloadStatus
  createdAt: Scalars['String']['output']
  createdAtBlock: Scalars['Int']['output']
  deliveredAt?: Maybe<Scalars['String']['output']>
  deliveredAtBlock?: Maybe<Scalars['Int']['output']>
  adapterSending?: Maybe<Scalars['String']['output']>
  adapterReceiving?: Maybe<Scalars['String']['output']>
  fromBlockchain?: Maybe<Blockchain>
  toBlockchain?: Maybe<Blockchain>
  crosschainMessages?: Maybe<CrosschainMessagePage>
  pool?: Maybe<Pool>
}

export type CrosschainPayloadCrosschainMessagesArgs = {
  where?: InputMaybe<CrosschainMessageFilter>
  orderBy?: InputMaybe<Scalars['String']['input']>
  orderDirection?: InputMaybe<Scalars['String']['input']>
  before?: InputMaybe<Scalars['String']['input']>
  after?: InputMaybe<Scalars['String']['input']>
  limit?: InputMaybe<Scalars['Int']['input']>
}

export enum CrosschainPayloadStatus {
  Underpaid = 'Underpaid',
  InProgress = 'InProgress',
  Delivered = 'Delivered',
  PartiallyFailed = 'PartiallyFailed',
}

export type CrosschainMessagePage = {
  __typename?: 'CrosschainMessagePage'
  items: Array<CrosschainMessage>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type CrosschainMessage = {
  __typename?: 'CrosschainMessage'
  id: Scalars['String']['output']
  index: Scalars['Int']['output']
  poolId?: Maybe<Scalars['BigInt']['output']>
  payloadId?: Maybe<Scalars['String']['output']>
  messageType: Scalars['String']['output']
  status: CrosschainMessageStatus
  data: Scalars['String']['output']
  fromCentrifugeId: Scalars['String']['output']
  toCentrifugeId: Scalars['String']['output']
  createdAt: Scalars['String']['output']
  createdAtBlock: Scalars['Int']['output']
  executedAt?: Maybe<Scalars['String']['output']>
  executedAtBlock?: Maybe<Scalars['Int']['output']>
  crosschainPayload?: Maybe<CrosschainPayload>
  pool?: Maybe<Pool>
  fromBlockchain?: Maybe<Blockchain>
  toBlockchain?: Maybe<Blockchain>
}

export enum CrosschainMessageStatus {
  AwaitingBatchDelivery = 'AwaitingBatchDelivery',
  Failed = 'Failed',
  Executed = 'Executed',
}

export type CrosschainMessageFilter = {
  AND?: InputMaybe<Array<InputMaybe<CrosschainMessageFilter>>>
  OR?: InputMaybe<Array<InputMaybe<CrosschainMessageFilter>>>
  id?: InputMaybe<Scalars['String']['input']>
  id_not?: InputMaybe<Scalars['String']['input']>
  id_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  id_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  id_contains?: InputMaybe<Scalars['String']['input']>
  id_not_contains?: InputMaybe<Scalars['String']['input']>
  id_starts_with?: InputMaybe<Scalars['String']['input']>
  id_ends_with?: InputMaybe<Scalars['String']['input']>
  id_not_starts_with?: InputMaybe<Scalars['String']['input']>
  id_not_ends_with?: InputMaybe<Scalars['String']['input']>
  index?: InputMaybe<Scalars['Int']['input']>
  index_not?: InputMaybe<Scalars['Int']['input']>
  index_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  index_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  index_gt?: InputMaybe<Scalars['Int']['input']>
  index_lt?: InputMaybe<Scalars['Int']['input']>
  index_gte?: InputMaybe<Scalars['Int']['input']>
  index_lte?: InputMaybe<Scalars['Int']['input']>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  payloadId?: InputMaybe<Scalars['String']['input']>
  payloadId_not?: InputMaybe<Scalars['String']['input']>
  payloadId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  payloadId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  payloadId_contains?: InputMaybe<Scalars['String']['input']>
  payloadId_not_contains?: InputMaybe<Scalars['String']['input']>
  payloadId_starts_with?: InputMaybe<Scalars['String']['input']>
  payloadId_ends_with?: InputMaybe<Scalars['String']['input']>
  payloadId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  payloadId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  messageType?: InputMaybe<Scalars['String']['input']>
  messageType_not?: InputMaybe<Scalars['String']['input']>
  messageType_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  messageType_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  messageType_contains?: InputMaybe<Scalars['String']['input']>
  messageType_not_contains?: InputMaybe<Scalars['String']['input']>
  messageType_starts_with?: InputMaybe<Scalars['String']['input']>
  messageType_ends_with?: InputMaybe<Scalars['String']['input']>
  messageType_not_starts_with?: InputMaybe<Scalars['String']['input']>
  messageType_not_ends_with?: InputMaybe<Scalars['String']['input']>
  status?: InputMaybe<CrosschainMessageStatus>
  status_not?: InputMaybe<CrosschainMessageStatus>
  status_in?: InputMaybe<Array<InputMaybe<CrosschainMessageStatus>>>
  status_not_in?: InputMaybe<Array<InputMaybe<CrosschainMessageStatus>>>
  data?: InputMaybe<Scalars['String']['input']>
  data_not?: InputMaybe<Scalars['String']['input']>
  data_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  data_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  data_contains?: InputMaybe<Scalars['String']['input']>
  data_not_contains?: InputMaybe<Scalars['String']['input']>
  data_starts_with?: InputMaybe<Scalars['String']['input']>
  data_ends_with?: InputMaybe<Scalars['String']['input']>
  data_not_starts_with?: InputMaybe<Scalars['String']['input']>
  data_not_ends_with?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId_not?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  fromCentrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  fromCentrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId_not?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  toCentrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  toCentrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  createdAt?: InputMaybe<Scalars['String']['input']>
  createdAt_not?: InputMaybe<Scalars['String']['input']>
  createdAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  createdAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  createdAt_contains?: InputMaybe<Scalars['String']['input']>
  createdAt_not_contains?: InputMaybe<Scalars['String']['input']>
  createdAt_starts_with?: InputMaybe<Scalars['String']['input']>
  createdAt_ends_with?: InputMaybe<Scalars['String']['input']>
  createdAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  createdAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  createdAtBlock?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  createdAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  createdAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
  executedAt?: InputMaybe<Scalars['String']['input']>
  executedAt_not?: InputMaybe<Scalars['String']['input']>
  executedAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  executedAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  executedAt_contains?: InputMaybe<Scalars['String']['input']>
  executedAt_not_contains?: InputMaybe<Scalars['String']['input']>
  executedAt_starts_with?: InputMaybe<Scalars['String']['input']>
  executedAt_ends_with?: InputMaybe<Scalars['String']['input']>
  executedAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  executedAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  executedAtBlock?: InputMaybe<Scalars['Int']['input']>
  executedAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  executedAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  executedAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  executedAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  executedAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  executedAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  executedAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
}

export type CrosschainPayloadPage = {
  __typename?: 'CrosschainPayloadPage'
  items: Array<CrosschainPayload>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type CrosschainPayloadFilter = {
  AND?: InputMaybe<Array<InputMaybe<CrosschainPayloadFilter>>>
  OR?: InputMaybe<Array<InputMaybe<CrosschainPayloadFilter>>>
  id?: InputMaybe<Scalars['String']['input']>
  id_not?: InputMaybe<Scalars['String']['input']>
  id_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  id_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  id_contains?: InputMaybe<Scalars['String']['input']>
  id_not_contains?: InputMaybe<Scalars['String']['input']>
  id_starts_with?: InputMaybe<Scalars['String']['input']>
  id_ends_with?: InputMaybe<Scalars['String']['input']>
  id_not_starts_with?: InputMaybe<Scalars['String']['input']>
  id_not_ends_with?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId_not?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  fromCentrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  fromCentrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  fromCentrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId_not?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  toCentrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  toCentrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  toCentrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  poolId?: InputMaybe<Scalars['BigInt']['input']>
  poolId_not?: InputMaybe<Scalars['BigInt']['input']>
  poolId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  poolId_gt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lt?: InputMaybe<Scalars['BigInt']['input']>
  poolId_gte?: InputMaybe<Scalars['BigInt']['input']>
  poolId_lte?: InputMaybe<Scalars['BigInt']['input']>
  votes?: InputMaybe<Scalars['Int']['input']>
  votes_not?: InputMaybe<Scalars['Int']['input']>
  votes_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  votes_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  votes_gt?: InputMaybe<Scalars['Int']['input']>
  votes_lt?: InputMaybe<Scalars['Int']['input']>
  votes_gte?: InputMaybe<Scalars['Int']['input']>
  votes_lte?: InputMaybe<Scalars['Int']['input']>
  status?: InputMaybe<CrosschainPayloadStatus>
  status_not?: InputMaybe<CrosschainPayloadStatus>
  status_in?: InputMaybe<Array<InputMaybe<CrosschainPayloadStatus>>>
  status_not_in?: InputMaybe<Array<InputMaybe<CrosschainPayloadStatus>>>
  createdAt?: InputMaybe<Scalars['String']['input']>
  createdAt_not?: InputMaybe<Scalars['String']['input']>
  createdAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  createdAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  createdAt_contains?: InputMaybe<Scalars['String']['input']>
  createdAt_not_contains?: InputMaybe<Scalars['String']['input']>
  createdAt_starts_with?: InputMaybe<Scalars['String']['input']>
  createdAt_ends_with?: InputMaybe<Scalars['String']['input']>
  createdAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  createdAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  createdAtBlock?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  createdAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  createdAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  createdAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
  deliveredAt?: InputMaybe<Scalars['String']['input']>
  deliveredAt_not?: InputMaybe<Scalars['String']['input']>
  deliveredAt_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  deliveredAt_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  deliveredAt_contains?: InputMaybe<Scalars['String']['input']>
  deliveredAt_not_contains?: InputMaybe<Scalars['String']['input']>
  deliveredAt_starts_with?: InputMaybe<Scalars['String']['input']>
  deliveredAt_ends_with?: InputMaybe<Scalars['String']['input']>
  deliveredAt_not_starts_with?: InputMaybe<Scalars['String']['input']>
  deliveredAt_not_ends_with?: InputMaybe<Scalars['String']['input']>
  deliveredAtBlock?: InputMaybe<Scalars['Int']['input']>
  deliveredAtBlock_not?: InputMaybe<Scalars['Int']['input']>
  deliveredAtBlock_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  deliveredAtBlock_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  deliveredAtBlock_gt?: InputMaybe<Scalars['Int']['input']>
  deliveredAtBlock_lt?: InputMaybe<Scalars['Int']['input']>
  deliveredAtBlock_gte?: InputMaybe<Scalars['Int']['input']>
  deliveredAtBlock_lte?: InputMaybe<Scalars['Int']['input']>
  adapterSending?: InputMaybe<Scalars['String']['input']>
  adapterSending_not?: InputMaybe<Scalars['String']['input']>
  adapterSending_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  adapterSending_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  adapterSending_contains?: InputMaybe<Scalars['String']['input']>
  adapterSending_not_contains?: InputMaybe<Scalars['String']['input']>
  adapterSending_starts_with?: InputMaybe<Scalars['String']['input']>
  adapterSending_ends_with?: InputMaybe<Scalars['String']['input']>
  adapterSending_not_starts_with?: InputMaybe<Scalars['String']['input']>
  adapterSending_not_ends_with?: InputMaybe<Scalars['String']['input']>
  adapterReceiving?: InputMaybe<Scalars['String']['input']>
  adapterReceiving_not?: InputMaybe<Scalars['String']['input']>
  adapterReceiving_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  adapterReceiving_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  adapterReceiving_contains?: InputMaybe<Scalars['String']['input']>
  adapterReceiving_not_contains?: InputMaybe<Scalars['String']['input']>
  adapterReceiving_starts_with?: InputMaybe<Scalars['String']['input']>
  adapterReceiving_ends_with?: InputMaybe<Scalars['String']['input']>
  adapterReceiving_not_starts_with?: InputMaybe<Scalars['String']['input']>
  adapterReceiving_not_ends_with?: InputMaybe<Scalars['String']['input']>
}

export type TokenSnapshot = {
  __typename?: 'TokenSnapshot'
  timestamp: Scalars['String']['output']
  blockNumber: Scalars['Int']['output']
  trigger: Scalars['String']['output']
  triggerTxHash?: Maybe<Scalars['String']['output']>
  triggerChainId: Scalars['String']['output']
  id: Scalars['String']['output']
  totalIssuance?: Maybe<Scalars['BigInt']['output']>
  tokenPrice?: Maybe<Scalars['BigInt']['output']>
}

export type TokenSnapshotPage = {
  __typename?: 'TokenSnapshotPage'
  items: Array<TokenSnapshot>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type TokenSnapshotFilter = {
  AND?: InputMaybe<Array<InputMaybe<TokenSnapshotFilter>>>
  OR?: InputMaybe<Array<InputMaybe<TokenSnapshotFilter>>>
  timestamp?: InputMaybe<Scalars['String']['input']>
  timestamp_not?: InputMaybe<Scalars['String']['input']>
  timestamp_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  timestamp_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  timestamp_contains?: InputMaybe<Scalars['String']['input']>
  timestamp_not_contains?: InputMaybe<Scalars['String']['input']>
  timestamp_starts_with?: InputMaybe<Scalars['String']['input']>
  timestamp_ends_with?: InputMaybe<Scalars['String']['input']>
  timestamp_not_starts_with?: InputMaybe<Scalars['String']['input']>
  timestamp_not_ends_with?: InputMaybe<Scalars['String']['input']>
  blockNumber?: InputMaybe<Scalars['Int']['input']>
  blockNumber_not?: InputMaybe<Scalars['Int']['input']>
  blockNumber_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  blockNumber_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  blockNumber_gt?: InputMaybe<Scalars['Int']['input']>
  blockNumber_lt?: InputMaybe<Scalars['Int']['input']>
  blockNumber_gte?: InputMaybe<Scalars['Int']['input']>
  blockNumber_lte?: InputMaybe<Scalars['Int']['input']>
  trigger?: InputMaybe<Scalars['String']['input']>
  trigger_not?: InputMaybe<Scalars['String']['input']>
  trigger_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  trigger_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  trigger_contains?: InputMaybe<Scalars['String']['input']>
  trigger_not_contains?: InputMaybe<Scalars['String']['input']>
  trigger_starts_with?: InputMaybe<Scalars['String']['input']>
  trigger_ends_with?: InputMaybe<Scalars['String']['input']>
  trigger_not_starts_with?: InputMaybe<Scalars['String']['input']>
  trigger_not_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerTxHash_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerTxHash_contains?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not_contains?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not?: InputMaybe<Scalars['String']['input']>
  triggerChainId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerChainId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerChainId_contains?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not_contains?: InputMaybe<Scalars['String']['input']>
  triggerChainId_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  id?: InputMaybe<Scalars['String']['input']>
  id_not?: InputMaybe<Scalars['String']['input']>
  id_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  id_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  id_contains?: InputMaybe<Scalars['String']['input']>
  id_not_contains?: InputMaybe<Scalars['String']['input']>
  id_starts_with?: InputMaybe<Scalars['String']['input']>
  id_ends_with?: InputMaybe<Scalars['String']['input']>
  id_not_starts_with?: InputMaybe<Scalars['String']['input']>
  id_not_ends_with?: InputMaybe<Scalars['String']['input']>
  totalIssuance?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_not?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  totalIssuance_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  totalIssuance_gt?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_lt?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_gte?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_lte?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_not?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  tokenPrice_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  tokenPrice_gt?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_lt?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_gte?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_lte?: InputMaybe<Scalars['BigInt']['input']>
}

export type TokenInstanceSnapshot = {
  __typename?: 'TokenInstanceSnapshot'
  timestamp: Scalars['String']['output']
  blockNumber: Scalars['Int']['output']
  trigger: Scalars['String']['output']
  triggerTxHash?: Maybe<Scalars['String']['output']>
  triggerChainId: Scalars['String']['output']
  centrifugeId: Scalars['String']['output']
  tokenId: Scalars['String']['output']
  tokenPrice?: Maybe<Scalars['BigInt']['output']>
  totalIssuance?: Maybe<Scalars['BigInt']['output']>
}

export type TokenInstanceSnapshotPage = {
  __typename?: 'TokenInstanceSnapshotPage'
  items: Array<TokenInstanceSnapshot>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type TokenInstanceSnapshotFilter = {
  AND?: InputMaybe<Array<InputMaybe<TokenInstanceSnapshotFilter>>>
  OR?: InputMaybe<Array<InputMaybe<TokenInstanceSnapshotFilter>>>
  timestamp?: InputMaybe<Scalars['String']['input']>
  timestamp_not?: InputMaybe<Scalars['String']['input']>
  timestamp_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  timestamp_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  timestamp_contains?: InputMaybe<Scalars['String']['input']>
  timestamp_not_contains?: InputMaybe<Scalars['String']['input']>
  timestamp_starts_with?: InputMaybe<Scalars['String']['input']>
  timestamp_ends_with?: InputMaybe<Scalars['String']['input']>
  timestamp_not_starts_with?: InputMaybe<Scalars['String']['input']>
  timestamp_not_ends_with?: InputMaybe<Scalars['String']['input']>
  blockNumber?: InputMaybe<Scalars['Int']['input']>
  blockNumber_not?: InputMaybe<Scalars['Int']['input']>
  blockNumber_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  blockNumber_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  blockNumber_gt?: InputMaybe<Scalars['Int']['input']>
  blockNumber_lt?: InputMaybe<Scalars['Int']['input']>
  blockNumber_gte?: InputMaybe<Scalars['Int']['input']>
  blockNumber_lte?: InputMaybe<Scalars['Int']['input']>
  trigger?: InputMaybe<Scalars['String']['input']>
  trigger_not?: InputMaybe<Scalars['String']['input']>
  trigger_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  trigger_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  trigger_contains?: InputMaybe<Scalars['String']['input']>
  trigger_not_contains?: InputMaybe<Scalars['String']['input']>
  trigger_starts_with?: InputMaybe<Scalars['String']['input']>
  trigger_ends_with?: InputMaybe<Scalars['String']['input']>
  trigger_not_starts_with?: InputMaybe<Scalars['String']['input']>
  trigger_not_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerTxHash_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerTxHash_contains?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not_contains?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not?: InputMaybe<Scalars['String']['input']>
  triggerChainId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerChainId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerChainId_contains?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not_contains?: InputMaybe<Scalars['String']['input']>
  triggerChainId_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not?: InputMaybe<Scalars['String']['input']>
  centrifugeId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  centrifugeId_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_contains?: InputMaybe<Scalars['String']['input']>
  centrifugeId_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_ends_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  centrifugeId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenPrice?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_not?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  tokenPrice_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  tokenPrice_gt?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_lt?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_gte?: InputMaybe<Scalars['BigInt']['input']>
  tokenPrice_lte?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_not?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  totalIssuance_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  totalIssuance_gt?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_lt?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_gte?: InputMaybe<Scalars['BigInt']['input']>
  totalIssuance_lte?: InputMaybe<Scalars['BigInt']['input']>
}

export type HoldingSnapshot = {
  __typename?: 'HoldingSnapshot'
  timestamp: Scalars['String']['output']
  blockNumber: Scalars['Int']['output']
  trigger: Scalars['String']['output']
  triggerTxHash?: Maybe<Scalars['String']['output']>
  triggerChainId: Scalars['String']['output']
  tokenId: Scalars['String']['output']
  assetId: Scalars['BigInt']['output']
  assetQuantity: Scalars['BigInt']['output']
  totalValue: Scalars['BigInt']['output']
}

export type HoldingSnapshotPage = {
  __typename?: 'HoldingSnapshotPage'
  items: Array<HoldingSnapshot>
  pageInfo: PageInfo
  totalCount: Scalars['Int']['output']
}

export type HoldingSnapshotFilter = {
  AND?: InputMaybe<Array<InputMaybe<HoldingSnapshotFilter>>>
  OR?: InputMaybe<Array<InputMaybe<HoldingSnapshotFilter>>>
  timestamp?: InputMaybe<Scalars['String']['input']>
  timestamp_not?: InputMaybe<Scalars['String']['input']>
  timestamp_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  timestamp_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  timestamp_contains?: InputMaybe<Scalars['String']['input']>
  timestamp_not_contains?: InputMaybe<Scalars['String']['input']>
  timestamp_starts_with?: InputMaybe<Scalars['String']['input']>
  timestamp_ends_with?: InputMaybe<Scalars['String']['input']>
  timestamp_not_starts_with?: InputMaybe<Scalars['String']['input']>
  timestamp_not_ends_with?: InputMaybe<Scalars['String']['input']>
  blockNumber?: InputMaybe<Scalars['Int']['input']>
  blockNumber_not?: InputMaybe<Scalars['Int']['input']>
  blockNumber_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  blockNumber_not_in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>
  blockNumber_gt?: InputMaybe<Scalars['Int']['input']>
  blockNumber_lt?: InputMaybe<Scalars['Int']['input']>
  blockNumber_gte?: InputMaybe<Scalars['Int']['input']>
  blockNumber_lte?: InputMaybe<Scalars['Int']['input']>
  trigger?: InputMaybe<Scalars['String']['input']>
  trigger_not?: InputMaybe<Scalars['String']['input']>
  trigger_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  trigger_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  trigger_contains?: InputMaybe<Scalars['String']['input']>
  trigger_not_contains?: InputMaybe<Scalars['String']['input']>
  trigger_starts_with?: InputMaybe<Scalars['String']['input']>
  trigger_ends_with?: InputMaybe<Scalars['String']['input']>
  trigger_not_starts_with?: InputMaybe<Scalars['String']['input']>
  trigger_not_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerTxHash_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerTxHash_contains?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not_contains?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerTxHash_not_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not?: InputMaybe<Scalars['String']['input']>
  triggerChainId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerChainId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  triggerChainId_contains?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not_contains?: InputMaybe<Scalars['String']['input']>
  triggerChainId_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId_ends_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  triggerChainId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId?: InputMaybe<Scalars['String']['input']>
  tokenId_not?: InputMaybe<Scalars['String']['input']>
  tokenId_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_not_in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>
  tokenId_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_not_contains?: InputMaybe<Scalars['String']['input']>
  tokenId_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_ends_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_starts_with?: InputMaybe<Scalars['String']['input']>
  tokenId_not_ends_with?: InputMaybe<Scalars['String']['input']>
  assetId?: InputMaybe<Scalars['BigInt']['input']>
  assetId_not?: InputMaybe<Scalars['BigInt']['input']>
  assetId_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetId_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetId_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetId_lte?: InputMaybe<Scalars['BigInt']['input']>
  assetQuantity?: InputMaybe<Scalars['BigInt']['input']>
  assetQuantity_not?: InputMaybe<Scalars['BigInt']['input']>
  assetQuantity_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetQuantity_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  assetQuantity_gt?: InputMaybe<Scalars['BigInt']['input']>
  assetQuantity_lt?: InputMaybe<Scalars['BigInt']['input']>
  assetQuantity_gte?: InputMaybe<Scalars['BigInt']['input']>
  assetQuantity_lte?: InputMaybe<Scalars['BigInt']['input']>
  totalValue?: InputMaybe<Scalars['BigInt']['input']>
  totalValue_not?: InputMaybe<Scalars['BigInt']['input']>
  totalValue_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  totalValue_not_in?: InputMaybe<Array<InputMaybe<Scalars['BigInt']['input']>>>
  totalValue_gt?: InputMaybe<Scalars['BigInt']['input']>
  totalValue_lt?: InputMaybe<Scalars['BigInt']['input']>
  totalValue_gte?: InputMaybe<Scalars['BigInt']['input']>
  totalValue_lte?: InputMaybe<Scalars['BigInt']['input']>
}
