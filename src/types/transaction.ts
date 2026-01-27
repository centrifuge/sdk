import {
  encodePacked,
  Log,
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

export type SafeMultisigTransactionResponse = {
  readonly safe: string
  readonly to: string
  readonly value: string
  readonly data?: string
  readonly operation: number
  readonly gasToken: string
  readonly safeTxGas: string
  readonly baseGas: string
  readonly gasPrice: string
  readonly refundReceiver?: string
  readonly nonce: string
  readonly executionDate: string | null
  readonly submissionDate: string
  readonly modified: string
  readonly blockNumber: number | null
  readonly transactionHash: string | null
  readonly safeTxHash: string
  readonly executor: string | null
  readonly proposer: string | null
  readonly proposedByDelegate: string | null
  readonly isExecuted: boolean
  readonly isSuccessful: boolean | null
  readonly ethGasPrice: string | null
  readonly maxFeePerGas: string | null
  readonly maxPriorityFeePerGas: string | null
  readonly gasUsed: number | null
  readonly fee: string | null
  readonly origin: string
  readonly dataDecoded?: any
  readonly confirmationsRequired: number
  readonly confirmations?: {
    readonly owner: string
    readonly submissionDate: string
    readonly transactionHash?: string
    readonly confirmationType?: string
    readonly signature: string
    readonly signatureType: 'CONTRACT_SIGNATURE' | 'EOA' | 'APPROVED_HASH' | 'ETH_SIGN'
  }[]
  readonly trusted: boolean
  readonly signatures: string | null
}

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

type SimulationResult = {
  data: HexString
  gasUsed: bigint
  status: string
  logs?: Log[]
}

export type SimulationStatus = {
  type: 'TransactionSimulation'
  title: string
  result: SimulationResult[]
}

export type DeployedOnOfframpManagerStatus = {
  type: 'DeployedOnOfframpManager'
  address: HexString
}

export type OperationStatus =
  | OperationSigningStatus
  | OperationSigningMessageStatus
  | OperationSignedMessageStatus
  | OperationPendingStatus
  | OperationConfirmedStatus
  | OperationSwitchChainStatus
  | SimulationStatus
  | DeployedOnOfframpManagerStatus

export type EIP1193ProviderLike = {
  request(...args: any): Promise<any>
}
export type Signer = EIP1193ProviderLike | LocalAccount

export type Transaction = Query<OperationStatus> & { centrifugeId: number }

export type TransactionContext = {
  isBatching?: boolean
  signingAddress: HexString
  chain: Chain
  centrifugeId: number
  publicClient: PublicClient
  walletClient: WalletClient<any, Chain, Account>
  signer: Signer
  root: Centrifuge
}

export enum MessageType {
  /// @dev Placeholder for null message type
  _Invalid,
  // -- Pool independent messages
  ScheduleUpgrade,
  CancelUpgrade,
  RecoverTokens,
  RegisterAsset,
  SetPoolAdapters,
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
  UpdateVault,
  UpdateBalanceSheetManager,
  UpdateGatewayManager,
  UpdateHoldingAmount,
  UpdateShares,
  SetMaxAssetPriceAge,
  SetMaxSharePriceAge,
  Request,
  RequestCallback,
  SetRequestManager,
  TrustedContractUpdate,
  UntrustedContractUpdate,
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
        ['uint8', 'uint64', 'bytes16', 'uint128', 'bytes32', 'uint8', 'uint128'],
        [type, 0n, toHex(0, { size: 16 }), 0n, toHex(0, { size: 32 }), subtype ?? VaultUpdateKind.DeployAndLink, 0n]
      )
    default:
      // Empty message with the length of the longest fixed-size message (NotifyShareClass with 250 bytes)
      return encodePacked(['uint8', 'bytes'], [1, toHex(0, { size: 249 })])
  }
}
