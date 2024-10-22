import type { Account, Chain, LocalAccount, PublicClient, TransactionReceipt, WalletClient } from 'viem'
import type { HexString } from './index.js'

export type OperationStatusType =
  | 'SwitchingChain'
  | 'SigningTransaction'
  | 'SigningMessage'
  | 'SignedMessage'
  | 'TransactionPending'
  | 'TransactionConfirmed'

export type OperationSigningStatus = {
  type: 'SigningTransaction'
  title: string
}
export type OperationSigningMessageStatus = {
  type: 'SigningMessage'
  title: string
}
export type OperationSignedMessageStatus = {
  type: 'SignedMessage'
  title: string
  signed: any
}
export type OperationPendingStatus = {
  type: 'TransactionPending'
  title: string
  hash: HexString
}
export type OperationConfirmedStatus = {
  type: 'TransactionConfirmed'
  title: string
  hash: HexString
  receipt: TransactionReceipt
}
export type OperationSwitchChainStatus = {
  type: 'SwitchingChain'
  chainId: number
}

export type OperationStatus =
  | OperationSigningStatus
  | OperationSigningMessageStatus
  | OperationSignedMessageStatus
  | OperationPendingStatus
  | OperationConfirmedStatus
  | OperationSwitchChainStatus

export type EIP1193ProviderLike = {
  request(...args: any): Promise<any>
}
export type Signer = EIP1193ProviderLike | LocalAccount

export type TransactionCallbackParams = {
  signingAddress: HexString
  chain: Chain
  chainId: number
  publicClient: PublicClient
  walletClient: WalletClient<any, Chain, Account>
  signer: Signer
}
