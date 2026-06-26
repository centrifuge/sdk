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
import { PoolId } from '../utils/types.js'
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

export type DeployedOnchainPMStatus = {
  type: 'DeployedOnchainPM'
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
  | DeployedOnchainPMStatus

export type EIP1193ProviderLike = {
  request(...args: any): Promise<any>
}
export type Signer = EIP1193ProviderLike | LocalAccount

export type Transaction = Query<OperationStatus> & { centrifugeId: number }

/** A single decoded inner call within a {@link BuiltTransaction}. */
export type BuiltCall = {
  to: HexString
  data: HexString
  value: bigint
}

/**
 * The unsigned transaction envelope produced by `Centrifuge.buildOnly`. It is
 * the calldata a transaction method *would* send, with no signing or broadcast.
 *
 * - `data` is the single call's calldata, or `multicall(bytes[])` calldata when
 *   more than one inner call is wrapped — byte-equal to what the signing path
 *   would send for the same inputs.
 * - `calls` exposes each inner call so consumers can inspect a batch without
 *   re-parsing the multicall.
 * - `messages` carries the cross-chain messages (if any) so consumers can run
 *   the same fee estimation the signing path does.
 */
export type BuiltTransaction = {
  centrifugeId: number
  chainId: number
  to: HexString
  data: HexString
  value: bigint
  calls: BuiltCall[]
  messages?: Record<number, MessageTypeWithSubType[]>
}

export type BuildOnlyOptions = {
  /**
   * Address to use as the build-time `signingAddress` for methods whose
   * construction reads it (e.g. permit flows). Defaults to the zero address.
   * No signing is performed with it — it is validated as an address and never
   * used to sign.
   */
  fromAddress?: HexString
}

export type TransactionContext = {
  isBatching?: boolean
  /**
   * Build-only mode. When true, the transaction is run to produce unsigned
   * calldata (via the `wrapTransaction` batching branch) and no signing,
   * broadcasting, chain switching, or wallet-client interaction happens.
   * In this mode `signer`/`walletClient` are not backed by a real signer and
   * must not be used; build callbacks may read `signingAddress` (defaults to
   * the zero address unless a `fromAddress` is supplied to `buildOnly`).
   */
  isBuilding?: boolean
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

export type MessageTypeWithSubType =
  | MessageType._Invalid
  | MessageType.ScheduleUpgrade
  | MessageType.CancelUpgrade
  | MessageType.RecoverTokens
  | MessageType.RegisterAsset
  | MessageType.SetPoolAdapters
  | {
      type:
        | MessageType.NotifyPool
        | MessageType.NotifyShareClass
        | MessageType.NotifyPricePoolPerShare
        | MessageType.NotifyPricePoolPerAsset
        | MessageType.NotifyShareMetadata
        | MessageType.UpdateShareHook
        | MessageType.InitiateTransferShares
        | MessageType.ExecuteTransferShares
        | MessageType.UpdateRestriction
        | MessageType.UpdateBalanceSheetManager
        | MessageType.UpdateGatewayManager
        | MessageType.UpdateHoldingAmount
        | MessageType.UpdateShares
        | MessageType.SetMaxAssetPriceAge
        | MessageType.SetMaxSharePriceAge
        | MessageType.Request
        | MessageType.RequestCallback
        | MessageType.SetRequestManager
        | MessageType.TrustedContractUpdate
        | MessageType.UntrustedContractUpdate
      poolId: PoolId
    }
  | { type: MessageType.UpdateVault; subtype: VaultUpdateKind; poolId: PoolId }

export function emptyMessage(type: MessageTypeWithSubType): HexString {
  if (typeof type === 'object' && type.type === MessageType.UpdateVault) {
    return encodePacked(
      ['uint8', 'uint64', 'bytes16', 'uint128', 'bytes32', 'uint8', 'uint128'],
      [
        type.type,
        type.poolId.raw,
        toHex(0, { size: 16 }),
        0n,
        toHex(0, { size: 32 }),
        type.subtype ?? VaultUpdateKind.DeployAndLink,
        0n,
      ]
    )
  }
  if (typeof type === 'object') {
    return encodePacked(
      ['uint8', 'uint64', 'bytes'],
      // Empty message with the length of the longest fixed-size message (NotifyShareClass with 250 bytes)
      [type.type, type.poolId.raw, toHex(0, { size: 241 })]
    )
  }

  return encodePacked(['uint8', 'bytes'], [type, toHex(0, { size: 249 })])
}
