import {
  encodePacked,
  toHex,
  type Account,
  type Chain,
  type LocalAccount,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from 'viem'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from './index.js'
import type { Query } from './query.js'

export type OperationStatusType =
  | 'SwitchingChain'
  | 'SigningTransaction'
  | 'SigningMessage'
  | 'SignedMessage'
  | 'TransactionPending'
  | 'TransactionConfirmed'

export type OperationSigningStatus = {
  id: string
  type: 'SigningTransaction'
  title: string
}
export type OperationSigningMessageStatus = {
  id: string
  type: 'SigningMessage'
  title: string
}
export type OperationSignedMessageStatus = {
  id: string
  type: 'SignedMessage'
  title: string
  signed: any
}
export type OperationPendingStatus = {
  id: string
  type: 'TransactionPending'
  title: string
  hash: HexString
}
export type OperationConfirmedStatus = {
  id: string
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

export type Transaction = Query<OperationStatus> & { chainId: number }

export type TransactionContext = {
  isBatching?: boolean
  signingAddress: HexString
  chain: Chain
  chainId: number
  publicClient: PublicClient
  walletClient: WalletClient<any, Chain, Account>
  signer: Signer
  root: Centrifuge
}

export enum MessageType {
  _Invalid,
  // -- Pool independent messages
  ScheduleUpgrade,
  CancelUpgrade,
  RecoverTokens,
  RegisterAsset,
  _Placeholder5,
  _Placeholder6,
  _Placeholder7,
  _Placeholder8,
  _Placeholder9,
  _Placeholder10,
  _Placeholder11,
  _Placeholder12,
  _Placeholder13,
  _Placeholder14,
  _Placeholder15,
  // -- Pool dependent messages
  NotifyPool,
  NotifyShareClass,
  NotifyPricePoolPerShare,
  NotifyPricePoolPerAsset,
  NotifyShareMetadata,
  UpdateShareHook,
  InitiateTransferShares,
  ExecuteTransferShares,
  UpdateRestriction,
  UpdateContract,
  UpdateVault,
  UpdateBalanceSheetManager,
  UpdateHoldingAmount,
  UpdateShares,
  MaxAssetPriceAge,
  MaxSharePriceAge,
  Request,
  RequestCallback,
  SetRequestManager,
}

export enum VaultUpdateKind {
  DeployAndLink,
  Link,
  Unlink,
}

export type MessageTypeWithSubType = MessageType | { type: MessageType; subtype: VaultUpdateKind }

export function emptyMessage(type: MessageType, subtype?: VaultUpdateKind): HexString {
  switch (type) {
    case MessageType.UpdateVault:
      return encodePacked(
        ['uint8', 'uint64', 'bytes16', 'uint128', 'bytes32', 'uint8'],
        [type, 0n, toHex(0, { size: 16 }), 0n, toHex(0, { size: 32 }), subtype ?? VaultUpdateKind.DeployAndLink]
      )
    default:
      return toHex(type, { size: 1 })
  }
}
